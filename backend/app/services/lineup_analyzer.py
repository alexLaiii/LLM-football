"""
Lineup strength analyzer.

Pipeline:
1. Fetch today's startXI / substitutes / injuries / recent fixtures / top scorer & assister.
2. Build each team's "expected XI" from startXI appearances over the last N fixtures,
   bucketed by position according to today's formation.
3. Identify regulars who didn't start today; tag each absence with a reason
   (injured / suspended / benched / unavailable) and impact (high / normal).
4. Flag heavy squad rotation when many regulars are missing.
5. Pass the structured summary to Claude Haiku for a natural-language write-up.
"""
import asyncio
import json
from datetime import datetime, timezone

import anthropic
import httpx

from app.config import settings
from app.services.football_api import _BASE_URL, _HEADERS, _r

_HAIKU_MODEL = "claude-haiku-4-5-20251001"
_RECENT_FIXTURES = 5
_HEAVY_ROTATION_THRESHOLD = 3
# Recent-form baseline window: only fixtures within this many days count, so months-
# old games don't pollute the "expected XI" (e.g. national teams between tournaments).
_STALE_BASELINE_DAYS = 30
# Rotation is only meaningful with several consistent recent games — one or two games
# can't tell a rotated lineup from a full-strength one (a single rotated friendly would
# make today's first XI look "rotated"). Below this many recent games, rotation is
# reported as "unknown" and we just give the AI the confirmed XI + injuries.
_MIN_BASELINE_GAMES = 3

_SYSTEM_PROMPT = """You are a football analyst summarizing lineup strength for a betting model.

The input JSON contains, for each team:
- formation: today's formation string (e.g. "4-3-3", "3-5-2", "4-2-3-1")
- starting_xi: confirmed startXI names
- missing_regulars: regulars who did not start today, each with:
    - position: G / D / M / F
    - appearances_recent: how many of the team's recent matches the player started
    - absence_reason: "injured" | "suspended" | "benched" | "unavailable"
    - impact: "high" (top scorer or top assister) | "normal"
- rotation: "heavy" if 3+ regulars are missing, "normal" if fewer, or "unknown"
  when there are too few recent matches to establish a reliable first-choice XI
  (e.g. a national team with only a stray friendly to compare against). When
  rotation is "unknown", missing_regulars is empty — there is no usable baseline.

Produce a concise 2-3 line summary covering:
- Notable missing regulars (name, position, reason, impact)
- Overall lineup strength (full-strength / weakened / significantly depleted)
- Whether either team is heavily rotated

If a team's rotation is "unknown", do NOT infer that it is full-strength or rotated.
Instead state that its lineup strength can't be judged from recent form (no recent
matches), while still reporting its confirmed starting XI and formation.

Output ONLY the plain-text summary. No markdown, no headers, no JSON."""


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _recent_finished_fixture_ids(recent_response: list, match_date: datetime | None) -> list[int]:
    """IDs of the team's recently-finished fixtures, used as the rotation baseline.
    When the match date is known, ONLY fixtures within _STALE_BASELINE_DAYS are kept,
    so a stale history (e.g. a national team's months-old games) can't pollute the
    expected XI — even if one of the last few games happens to be recent. Returns []
    when no fixture qualifies; the team then has no usable baseline (rotation
    'unknown'). With an unknown match date, no date filter is applied (old behaviour)."""
    ids = []
    for f in recent_response:
        if f["fixture"]["status"]["short"] not in ("FT", "AET", "PEN"):
            continue
        if match_date is not None:
            played = _parse_iso(f["fixture"].get("date"))
            if played is None or not (0 <= (match_date - played).days <= _STALE_BASELINE_DAYS):
                continue
        ids.append(f["fixture"]["id"])
    return ids[:_RECENT_FIXTURES]


async def analyze_lineups(external_id: str) -> str | None:
    if not settings.apifootball_api_key or not settings.anthropic_api_key:
        return None
    if external_id.startswith("mock_"):
        return None

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            fixture_r, lineups_r, injuries_r = await asyncio.gather(
                client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                           params={"id": external_id}),
                client.get(f"{_BASE_URL}/fixtures/lineups", headers=_HEADERS(),
                           params={"fixture": external_id}),
                client.get(f"{_BASE_URL}/injuries", headers=_HEADERS(),
                           params={"fixture": external_id}),
            )

            fixture_data = _r(fixture_r)
            lineups_data = _r(lineups_r)
            injuries_data = _r(injuries_r)
            if not fixture_data or not lineups_data:
                return None

            fx = fixture_data[0]
            home_id = fx["teams"]["home"]["id"]
            away_id = fx["teams"]["away"]["id"]
            home_name = fx["teams"]["home"]["name"]
            away_name = fx["teams"]["away"]["name"]
            league_id = fx["league"]["id"]
            season = fx["league"]["season"]

            home_formation, home_xi, home_subs = _extract_lineup(lineups_data, home_id)
            away_formation, away_xi, away_subs = _extract_lineup(lineups_data, away_id)
            if not home_xi or not away_xi:
                return None

            home_recent_r, away_recent_r, scorers_r, assists_r = await asyncio.gather(
                client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                           params={"team": home_id, "last": _RECENT_FIXTURES}),
                client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                           params={"team": away_id, "last": _RECENT_FIXTURES}),
                client.get(f"{_BASE_URL}/players/topscorers", headers=_HEADERS(),
                           params={"league": league_id, "season": season}),
                client.get(f"{_BASE_URL}/players/topassists", headers=_HEADERS(),
                           params={"league": league_id, "season": season}),
            )

            # Baseline = only fixtures within the recency window, so months-old games
            # don't pollute the expected XI. A team with too few recent games has no
            # reliable baseline (can't distinguish rotation from full strength).
            match_date = _parse_iso(fx["fixture"].get("date"))
            home_recent_ids = _recent_finished_fixture_ids(_r(home_recent_r), match_date)
            away_recent_ids = _recent_finished_fixture_ids(_r(away_recent_r), match_date)
            home_stale = len(home_recent_ids) < _MIN_BASELINE_GAMES
            away_stale = len(away_recent_ids) < _MIN_BASELINE_GAMES
            # Stale teams get no baseline — skip their historic lineup fetches too.
            home_fixture_ids = [] if home_stale else home_recent_ids
            away_fixture_ids = [] if away_stale else away_recent_ids
            scorers_data = _r(scorers_r)
            assists_data = _r(assists_r)

            historic_calls = [
                client.get(f"{_BASE_URL}/fixtures/lineups", headers=_HEADERS(),
                           params={"fixture": fid})
                for fid in home_fixture_ids + away_fixture_ids
            ]
            historic_responses = await asyncio.gather(*historic_calls, return_exceptions=True)

        home_split = len(home_fixture_ids)
        home_historic = [_r(r) for r in historic_responses[:home_split]]
        away_historic = [_r(r) for r in historic_responses[home_split:]]

        home_expected = _build_expected_xi(home_historic, home_id, home_formation)
        away_expected = _build_expected_xi(away_historic, away_id, away_formation)

        home_high_impact = _high_impact_ids(scorers_data, assists_data, home_id)
        away_high_impact = _high_impact_ids(scorers_data, assists_data, away_id)

        home_missing = [] if home_stale else _build_missing_regulars(
            home_expected, home_xi, home_subs, injuries_data, home_id, home_high_impact,
        )
        away_missing = [] if away_stale else _build_missing_regulars(
            away_expected, away_xi, away_subs, injuries_data, away_id, away_high_impact,
        )

        home_rotation = "unknown" if home_stale else ("heavy" if len(home_missing) >= _HEAVY_ROTATION_THRESHOLD else "normal")
        away_rotation = "unknown" if away_stale else ("heavy" if len(away_missing) >= _HEAVY_ROTATION_THRESHOLD else "normal")

        structured = {
            "home_team": home_name,
            "home_formation": home_formation,
            "home_starting_xi": [p["name"] for p in home_xi],
            "home_missing_regulars": home_missing,
            "home_rotation": home_rotation,
            "away_team": away_name,
            "away_formation": away_formation,
            "away_starting_xi": [p["name"] for p in away_xi],
            "away_missing_regulars": away_missing,
            "away_rotation": away_rotation,
        }

        anth_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await anth_client.messages.create(
            model=_HAIKU_MODEL,
            max_tokens=250,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(structured)}],
        )
        return response.content[0].text.strip()
    except Exception:
        return None


def _extract_lineup(lineups_response: list, team_id: int) -> tuple[str, list[dict], list[dict]]:
    for lineup in lineups_response:
        if lineup["team"]["id"] != team_id:
            continue
        formation = lineup.get("formation") or ""
        xi = [
            {"id": p["player"]["id"],
             "name": p["player"]["name"],
             "position": p["player"].get("pos", "")}
            for p in lineup.get("startXI", [])
        ]
        subs = [
            {"id": p["player"]["id"], "name": p["player"]["name"]}
            for p in lineup.get("substitutes", [])
        ]
        return formation, xi, subs
    return "", [], []


_POSITION_KEYS = ("G", "D", "M", "F")
_DEFAULT_QUOTA = {"G": 1, "D": 4, "M": 3, "F": 3}


def _formation_quota(formation: str) -> dict[str, int]:
    """First number = defenders, last = forwards, sum of middle = midfielders."""
    try:
        parts = [int(x) for x in formation.split("-") if x.strip().isdigit()]
        if len(parts) < 3:
            return dict(_DEFAULT_QUOTA)
        return {"G": 1, "D": parts[0], "M": sum(parts[1:-1]), "F": parts[-1]}
    except Exception:
        return dict(_DEFAULT_QUOTA)


def _build_expected_xi(historic_lineups: list, team_id: int, formation: str) -> list[dict]:
    """Each team's first-choice XI, inferred from recent startXI appearances and
    bucketed by today's formation. A player only counts as a "regular" if he started
    a majority of the recent games — this keeps one-off starters (who'd otherwise fill
    a thin position bucket and be falsely flagged as "missing" when rested) out."""
    quota = _formation_quota(formation)
    counters: dict[str, dict[int, dict]] = {pos: {} for pos in _POSITION_KEYS}
    total_games = 0
    for lineup_response in historic_lineups:
        team_started_xi = [
            p
            for lineup in lineup_response if lineup["team"]["id"] == team_id
            for p in lineup.get("startXI", [])
        ]
        if not team_started_xi:
            continue
        total_games += 1
        for p in team_started_xi:
            pid = p["player"]["id"]
            pos = p["player"].get("pos", "")
            if pos not in counters:
                continue
            bucket = counters[pos]
            if pid not in bucket:
                bucket[pid] = {"id": pid, "name": p["player"]["name"], "position": pos, "appearances": 0}
            bucket[pid]["appearances"] += 1

    # Regular = started a strict majority of the recent games (e.g. 2 of 3, 3 of 5).
    min_starts = total_games // 2 + 1
    expected: list[dict] = []
    for pos in _POSITION_KEYS:
        regulars = [p for p in counters[pos].values() if p["appearances"] >= min_starts]
        ranked = sorted(regulars, key=lambda p: p["appearances"], reverse=True)
        expected.extend(ranked[:quota.get(pos, 0)])
    return expected


def _high_impact_ids(scorers_data: list, assists_data: list, team_id: int) -> set[int]:
    """Returns player IDs of the team's top scorer and top assister."""
    ids: set[int] = set()
    for source in (scorers_data, assists_data):
        for entry in source:
            stats = entry.get("statistics", [])
            if not stats:
                continue
            if stats[0]["team"]["id"] == team_id:
                ids.add(entry["player"]["id"])
                break
    return ids


_SUSPENSION_KEYWORDS = ("yellow card", "red card", "suspension", "suspended")


def _classify_absence(
    player_id: int, injuries_data: list, team_id: int, sub_ids: set[int],
) -> str:
    """One of 'injured' | 'suspended' | 'benched' | 'unavailable'."""
    for inj in injuries_data:
        if inj["team"]["id"] != team_id or inj["player"]["id"] != player_id:
            continue
        reason = (inj["player"].get("reason") or "").lower()
        if any(kw in reason for kw in _SUSPENSION_KEYWORDS):
            return "suspended"
        return "injured"
    if player_id in sub_ids:
        return "benched"
    return "unavailable"


def _build_missing_regulars(
    expected_xi: list[dict],
    actual_xi: list[dict],
    substitutes: list[dict],
    injuries_data: list,
    team_id: int,
    high_impact_ids: set[int],
) -> list[dict]:
    actual_ids = {p["id"] for p in actual_xi}
    sub_ids = {p["id"] for p in substitutes}
    out: list[dict] = []
    for exp in expected_xi:
        if exp["id"] in actual_ids:
            continue
        reason = _classify_absence(exp["id"], injuries_data, team_id, sub_ids)
        impact = "high" if exp["id"] in high_impact_ids else "normal"
        out.append({
            "name": exp["name"],
            "position": exp["position"],
            "appearances_recent": exp["appearances"],
            "absence_reason": reason,
            "impact": impact,
        })
    return out
