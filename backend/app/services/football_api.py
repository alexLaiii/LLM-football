"""
API-Football v3 integration.
Docs: https://www.api-football.com/documentation-v3
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_BASE_URL = "https://v3.football.api-sports.io"
_HEADERS = lambda: {"x-apisports-key": settings.apifootball_api_key}
_FINISHED_STATUSES = ("FT", "AET", "PEN")
_UPCOMING_DAYS = 14

# league_id -> (display_name, season_year)
_LEAGUES: dict[int, tuple[str, int]] = {
    # season year — update each August for Euro leagues, 4 years for World cups
    39:  ("Premier League", 2025),
    140: ("La Liga", 2025),
    78:  ("Bundesliga", 2025),
    61:  ("Ligue 1", 2025),
    135: ("Serie A", 2025),
    2:   ("UEFA Champions League", 2025),
    3:   ("UEFA Europa League", 2025),
    1:   ("World Cup", 2026),
}

_MOCK_FIXTURES = [
    {
        "external_id": "mock_001",
        "home_team": "Arsenal",
        "away_team": "Chelsea",
        "home_team_id": None,
        "away_team_id": None,
        "league": "Premier League",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
    },
    {
        "external_id": "mock_002",
        "home_team": "Real Madrid",
        "away_team": "Barcelona",
        "home_team_id": None,
        "away_team_id": None,
        "league": "La Liga",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
    },
    {
        "external_id": "mock_003",
        "home_team": "Bayern Munich",
        "away_team": "Borussia Dortmund",
        "home_team_id": None,
        "away_team_id": None,
        "league": "Bundesliga",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=4)).isoformat(),
    },
    {
        "external_id": "mock_004",
        "home_team": "PSG",
        "away_team": "Marseille",
        "home_team_id": None,
        "away_team_id": None,
        "league": "Ligue 1",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=6)).isoformat(),
    },
    {
        "external_id": "mock_005",
        "home_team": "Inter Milan",
        "away_team": "AC Milan",
        "home_team_id": None,
        "away_team_id": None,
        "league": "Serie A",
        "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    },
]


def _r(result) -> list:
    """Safely extract the response list from an API-Football result or exception."""
    if isinstance(result, Exception):
        return []
    if isinstance(result, httpx.Response):
        if result.status_code != 200:
            return []
        data = result.json()
    else:
        data = result
    return data.get("response", []) if isinstance(data, dict) else []


def _ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        return f"{n}th"
    return f"{n}{['th', 'st', 'nd', 'rd', 'th'][min(n % 10, 4)]}"


def _form_stats(fixtures: list, team_id: int, last_n: int = 5,
                home_only: bool = False, away_only: bool = False) -> dict | None:
    """Last `last_n` truly-finished matches (status FT/AET/PEN). API returns newest-first.
    Returns None when no qualifying matches are available."""
    filtered = []
    for fx in fixtures:
        if fx["fixture"]["status"]["short"] not in _FINISHED_STATUSES:
            continue
        if fx["goals"]["home"] is None or fx["goals"]["away"] is None:
            continue
        home_id = fx["teams"]["home"]["id"]
        away_id = fx["teams"]["away"]["id"]
        if home_only and home_id != team_id:
            continue
        if away_only and away_id != team_id:
            continue
        filtered.append(fx)
        if len(filtered) == last_n:
            break

    if not filtered:
        return None

    wins = draws = losses = gf = ga = 0
    for fx in filtered:
        is_home = fx["teams"]["home"]["id"] == team_id
        gh = fx["goals"]["home"]
        ga_ = fx["goals"]["away"]
        g_for  = gh if is_home else ga_
        g_agst = ga_ if is_home else gh
        gf += g_for
        ga += g_agst
        if g_for > g_agst:
            wins += 1
        elif g_for == g_agst:
            draws += 1
        else:
            losses += 1

    n = len(filtered)
    return {
        "games": n, "wins": wins, "draws": draws, "losses": losses,
        "points": wins * 3 + draws,
        "goals_for": gf, "goals_against": ga, "goal_diff": gf - ga,
        "goals_for_avg": round(gf / n, 2),
        "goals_against_avg": round(ga / n, 2),
    }


def _rest_days(fixtures: list, fixture_date: datetime) -> int | None:
    """Days since the team's most recent truly-finished match before this fixture."""
    finished = [
        fx for fx in fixtures
        if fx["fixture"]["status"]["short"] in _FINISHED_STATUSES
    ]
    if not finished:
        return None
    last_date_str = finished[0]["fixture"]["date"]
    last_date = datetime.fromisoformat(last_date_str)
    if last_date.tzinfo is None:
        last_date = last_date.replace(tzinfo=timezone.utc)
    delta_days = (fixture_date - last_date).days
    return delta_days if delta_days >= 0 else None


def _h2h_stats(fixtures: list, home_id: int, away_id: int, last_n: int = 5) -> dict | None:
    """Last `last_n` truly-finished H2H matches. Returns None when no H2H data is available."""
    finished = [
        fx for fx in fixtures
        if fx["fixture"]["status"]["short"] in _FINISHED_STATUSES
        and fx["goals"]["home"] is not None
        and fx["goals"]["away"] is not None
    ]
    if not finished:
        return None
    selected = finished[:last_n]

    home_wins = draws = away_wins = total_goals = 0
    for fx in selected:
        gh = fx["goals"]["home"]
        ga = fx["goals"]["away"]
        total_goals += gh + ga
        fh_id = fx["teams"]["home"]["id"]
        fa_id = fx["teams"]["away"]["id"]
        if (fh_id == home_id and gh > ga) or (fa_id == home_id and ga > gh):
            home_wins += 1
        elif (fh_id == away_id and gh > ga) or (fa_id == away_id and ga > gh):
            away_wins += 1
        else:
            draws += 1
    n = len(selected)
    return {
        "games": n, "home_wins": home_wins, "draws": draws, "away_wins": away_wins,
        "avg_goals": round(total_goals / n, 2),
    }


def _standing(standings_response: list, team_id: int) -> dict | None:
    if not standings_response:
        return None
    # standings_response[0]["league"]["standings"] is a list of groups/tables
    tables = standings_response[0].get("league", {}).get("standings", [])
    for table in tables:
        for entry in table:
            if entry["team"]["id"] == team_id:
                gd = entry["goalsDiff"]
                all_s = entry["all"]
                return {
                    "position": entry["rank"],
                    "points": entry["points"],
                    "played": all_s["played"],
                    "won": all_s["win"],
                    "draw": all_s["draw"],
                    "lost": all_s["lose"],
                    "goals_for": all_s["goals"]["for"],
                    "goals_against": all_s["goals"]["against"],
                    "goal_diff": gd,
                }
    return None


def _top_scorer(scorers_response: list, team_id: int) -> dict | None:
    for scorer in scorers_response:
        stats = scorer.get("statistics", [])
        if not stats:
            continue
        if stats[0]["team"]["id"] == team_id:
            goals = stats[0]["goals"]["total"] or 0
            return {"name": scorer["player"]["name"], "goals": goals}
    return None


def _lineup_str(lineups_response: list, team_id: int) -> str | None:
    for lineup in lineups_response:
        if lineup["team"]["id"] != team_id:
            continue
        starters = lineup.get("startXI", [])
        if not starters:                    
            return None
        names = ", ".join(p["player"]["name"] for p in starters)
        formation = lineup.get("formation")
        return f"{formation}: {names}" if formation else names
    return None


def _injuries_str(injuries_response: list, team_id: int) -> str | None:
    seen: dict[int, dict] = {}
    for i in injuries_response:
        if i["team"]["id"] != team_id:
            continue
        seen.setdefault(i["player"]["id"], i["player"])
    if not seen:
        return None
    return ", ".join(f"{p['name']} ({p['reason']})" for p in seen.values())


async def fetch_upcoming_fixtures() -> list[dict]:
    if not settings.apifootball_api_key:
        return _MOCK_FIXTURES

    today = datetime.now(timezone.utc)
    date_from = today.strftime("%Y-%m-%d")
    date_to = (today + timedelta(days=_UPCOMING_DAYS - 1)).strftime("%Y-%m-%d")

    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [
            client.get(
                f"{_BASE_URL}/fixtures",
                headers=_HEADERS(),
                params={
                    "league": league_id,
                    "season": season,
                    "from": date_from,
                    "to": date_to,
                    "status": "NS-TBD",
                },
            )
            for league_id, (_, season) in _LEAGUES.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    fixtures = []
    for league_id, result in zip(_LEAGUES.keys(), results):
        league_name, _ = _LEAGUES[league_id]
        for fx in _r(result):
            fixtures.append({
                "external_id": str(fx["fixture"]["id"]),
                "home_team": fx["teams"]["home"]["name"],
                "away_team": fx["teams"]["away"]["name"],
                "home_team_id": fx["teams"]["home"]["id"],
                "away_team_id": fx["teams"]["away"]["id"],
                "home_team_crest": fx["teams"]["home"].get("logo"),
                "away_team_crest": fx["teams"]["away"].get("logo"),
                "league": league_name,
                "kickoff_at": fx["fixture"]["date"],
            })

    return fixtures if fixtures else _MOCK_FIXTURES


async def fetch_match_context(external_id: str) -> dict:
    """Returns form, standings, H2H, injuries, and lineup data for a fixture."""
    if not settings.apifootball_api_key or external_id.startswith("mock_"):
        return {
            "home_position": "8th (48pts, GD +5)",
            "away_position": "2nd (81pts, GD +52)",
            "home_form": "W3-1 W2-0 D1-1 W2-1 W1-0",
            "away_form": "W4-0 W3-1 D2-2 W2-0 W1-0",
            "h2h_summary": "Last 5 H2H: home team won 3, away won 1, drew 1.",
            "home_goals_avg": 1.8,
            "away_goals_avg": 1.3,
        }

    async with httpx.AsyncClient(timeout=30) as client:
        fixture_r = await client.get(
            f"{_BASE_URL}/fixtures",
            headers=_HEADERS(),
            params={"id": external_id},
        )

    fixture_data = _r(fixture_r)
    if not fixture_data:
        return {}

    fx = fixture_data[0]
    home_id = fx["teams"]["home"]["id"]
    away_id = fx["teams"]["away"]["id"]
    league_id = fx["league"]["id"]
    season = fx["league"]["season"]
    match_round = fx["league"].get("round", "")
    _fv = fx["fixture"].get("venue", {}) or {}
    fixture_venue_id = _fv.get("id")
    fixture_venue_name = (_fv.get("name") or "").strip().lower()
    fixture_date_str = fx["fixture"]["date"]
    fixture_date = datetime.fromisoformat(fixture_date_str)
    if fixture_date.tzinfo is None:
        fixture_date = fixture_date.replace(tzinfo=timezone.utc)

    async with httpx.AsyncClient(timeout=30) as client:
        (
            home_r, away_r, h2h_r,
            standings_r, scorers_r,
            injuries_r, lineups_r,
            home_team_r,
        ) = await asyncio.gather(
            client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                       params={"team": home_id, "last": 20}),
            client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                       params={"team": away_id, "last": 20}),
            client.get(f"{_BASE_URL}/fixtures/headtohead", headers=_HEADERS(),
                       params={"h2h": f"{home_id}-{away_id}", "last": 10}),
            client.get(f"{_BASE_URL}/standings", headers=_HEADERS(),
                       params={"league": league_id, "season": season}),
            client.get(f"{_BASE_URL}/players/topscorers", headers=_HEADERS(),
                       params={"league": league_id, "season": season}),
            client.get(f"{_BASE_URL}/injuries", headers=_HEADERS(),
                       params={"fixture": external_id}),
            client.get(f"{_BASE_URL}/fixtures/lineups", headers=_HEADERS(),
                       params={"fixture": external_id}),
            client.get(f"{_BASE_URL}/teams", headers=_HEADERS(),
                       params={"id": home_id}),
            return_exceptions=True,
        )

    home_fixtures  = _r(home_r)
    away_fixtures  = _r(away_r)
    h2h_fixtures   = _r(h2h_r)

    home_team_data = _r(home_team_r)
    home_venue_id = home_team_data[0]["venue"]["id"] if home_team_data else None
    home_venue_name = (((home_team_data[0].get("venue") or {}).get("name")) or "").strip().lower() if home_team_data else ""
    if fixture_venue_id is not None and home_venue_id is not None:
        neutral_venue = fixture_venue_id != home_venue_id
    elif fixture_venue_name and home_venue_name:
        neutral_venue = fixture_venue_name != home_venue_name
    else:
        neutral_venue = False
    standings_data = _r(standings_r)
    scorers_data   = _r(scorers_r)
    injuries_data  = _r(injuries_r)
    lineups_data   = _r(lineups_r)

    # Retry-on-empty for historical fields only. The parallel gather above sometimes
    # returns empty for one of these sub-calls under load even though data exists.
    # Non-historical fields (standings, scorers, injuries, lineups) can legitimately
    # be empty so we do NOT retry them.
    retry_specs: list[tuple[str, str, dict]] = []
    if not home_fixtures:
        logger.warning(
            "Historical field 'home_recent_fixtures' empty (fixture=%s home_id=%s endpoint=/fixtures) — scheduling retry",
            external_id, home_id,
        )
        retry_specs.append(("home_fixtures", f"{_BASE_URL}/fixtures", {"team": home_id, "last": 20}))
    if not away_fixtures:
        logger.warning(
            "Historical field 'away_recent_fixtures' empty (fixture=%s away_id=%s endpoint=/fixtures) — scheduling retry",
            external_id, away_id,
        )
        retry_specs.append(("away_fixtures", f"{_BASE_URL}/fixtures", {"team": away_id, "last": 20}))
    if not h2h_fixtures:
        logger.warning(
            "Historical field 'h2h' empty (fixture=%s home_id=%s away_id=%s endpoint=/fixtures/headtohead) — scheduling retry",
            external_id, home_id, away_id,
        )
        retry_specs.append(("h2h_fixtures", f"{_BASE_URL}/fixtures/headtohead", {"h2h": f"{home_id}-{away_id}", "last": 10}))

    if retry_specs:
        await asyncio.sleep(0.5)
        async with httpx.AsyncClient(timeout=30) as client:
            retry_results = await asyncio.gather(
                *[client.get(url, headers=_HEADERS(), params=params) for _, url, params in retry_specs],
                return_exceptions=True,
            )
        for spec, result in zip(retry_specs, retry_results):
            name = spec[0]
            retried = _r(result)
            if retried:
                logger.info("Retry succeeded for %s (fixture=%s, %d results)", name, external_id, len(retried))
            else:
                logger.warning("Retry still empty for %s (fixture=%s) — field will be null", name, external_id)
            if name == "home_fixtures":
                home_fixtures = retried or home_fixtures
            elif name == "away_fixtures":
                away_fixtures = retried or away_fixtures
            elif name == "h2h_fixtures":
                h2h_fixtures = retried or h2h_fixtures

    home_last5      = _form_stats(home_fixtures, home_id, last_n=5)
    home_last5_home = None if neutral_venue else _form_stats(home_fixtures, home_id, last_n=5, home_only=True)
    away_last5      = _form_stats(away_fixtures, away_id, last_n=5)
    away_last5_away = None if neutral_venue else _form_stats(away_fixtures, away_id, last_n=5, away_only=True)

    home_standing = _standing(standings_data, home_id)
    away_standing = _standing(standings_data, away_id)
    home_scorer   = _top_scorer(scorers_data, home_id)
    away_scorer   = _top_scorer(scorers_data, away_id)
    h2h           = _h2h_stats(h2h_fixtures, home_id, away_id)
    home_rest     = _rest_days(home_fixtures, fixture_date)
    away_rest     = _rest_days(away_fixtures, fixture_date)

    def _standing_str(standing: dict | None) -> str | None:
        if not standing:
            return None
        gd = standing["goal_diff"]
        return f"{_ordinal(standing['position'])} ({standing['points']}pts, GD {'+' if gd >= 0 else ''}{gd})"

    # Historical fields are ALWAYS included (with explicit null when unavailable
    # after retry) so the AI sees "unavailable" rather than a silently missing key.
    result: dict = {
        "home_team": fx["teams"]["home"]["name"],
        "away_team": fx["teams"]["away"]["name"],
        "match_round": match_round,
        "neutral_venue": neutral_venue,
        "home_last5": home_last5,
        "away_last5": away_last5,
        "home_goals_avg_last5": home_last5["goals_for_avg"] if home_last5 else None,
        "away_goals_avg_last5": away_last5["goals_for_avg"] if away_last5 else None,
        "home_rest_days": home_rest,
        "away_rest_days": away_rest,
        "h2h": h2h,
        "h2h_summary": (
            f"Last {h2h['games']} H2H: home team won {h2h['home_wins']}, "
            f"away won {h2h['away_wins']}, drew {h2h['draws']}."
            if h2h else "No H2H data available."
        ),
    }
    if not neutral_venue:
        result["home_last5_home"] = home_last5_home
        result["home_goals_avg_last5_home"] = home_last5_home["goals_for_avg"] if home_last5_home else None
        result["away_last5_away"] = away_last5_away
        result["away_goals_avg_last5_away"] = away_last5_away["goals_for_avg"] if away_last5_away else None

    if home_standing:
        result["home_standing"] = home_standing
        result["home_position"] = _standing_str(home_standing)
    if away_standing:
        result["away_standing"] = away_standing
        result["away_position"] = _standing_str(away_standing)
    if home_scorer:
        result["home_top_scorer"] = home_scorer
    if away_scorer:
        result["away_top_scorer"] = away_scorer

    home_lineup = _lineup_str(lineups_data, home_id)
    away_lineup = _lineup_str(lineups_data, away_id)
    if home_lineup:
        result["home_lineup"] = home_lineup
    if away_lineup:
        result["away_lineup"] = away_lineup

    home_injuries = _injuries_str(injuries_data, home_id)
    away_injuries = _injuries_str(injuries_data, away_id)
    if home_injuries:
        result["home_injuries"] = home_injuries
    if away_injuries:
        result["away_injuries"] = away_injuries

    return result


async def fetch_result(external_id: str) -> dict | None:
    """Returns {"outcome": "home"|"draw"|"away", "home_goals": int, "away_goals": int} or None."""
    if not settings.apifootball_api_key or external_id.startswith("mock_"):
        return None

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{_BASE_URL}/fixtures",
            headers=_HEADERS(),
            params={"id": external_id},
        )

    data = _r(r)
    if not data:
        return None
    fx = data[0]
    if fx["fixture"]["status"]["short"] not in ("FT", "AET", "PEN"):
        return None
    home_goals = fx["goals"]["home"]
    away_goals = fx["goals"]["away"]
    if home_goals is None or away_goals is None:
        return None
    if home_goals > away_goals:
        outcome = "home"
    elif away_goals > home_goals:
        outcome = "away"
    else:
        outcome = "draw"
    return {"outcome": outcome, "home_goals": home_goals, "away_goals": away_goals}


# Short cache to dedupe concurrent lookups; frontend polls at 5-min intervals.
_LINEUP_AVAILABLE_TTL = 60
_lineup_available_cache: dict[str, tuple[float, bool]] = {}


async def fetch_lineup_available(external_id: str) -> bool:
    """True if API-Football has posted the official startXI for this fixture."""
    if not settings.apifootball_api_key or external_id.startswith("mock_"):
        return False

    now = time.time()
    cached = _lineup_available_cache.get(external_id)
    if cached and now - cached[0] < _LINEUP_AVAILABLE_TTL:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{_BASE_URL}/fixtures/lineups",
                headers=_HEADERS(),
                params={"fixture": external_id},
            )
        data = _r(r)
        available = any(lineup.get("startXI") for lineup in data)
    except Exception:
        available = False

    _lineup_available_cache[external_id] = (now, available)
    return available


_LINEUP_DETAILS_TTL = 60
_lineup_details_cache: dict[str, tuple[float, dict | None]] = {}


def _lineup_team_payload(lineup: dict) -> dict:
    """Convert one API-Football lineup entry into the trimmed shape the frontend renders."""
    players = []
    for entry in lineup.get("startXI", []) or []:
        p = entry.get("player") or {}
        name = p.get("name")
        if not name:
            continue
        players.append({
            "name": name,
            "number": p.get("number"),
            "pos": p.get("pos") or "",
            "grid": p.get("grid"),
        })
    return {
        "team": (lineup.get("team") or {}).get("name") or "",
        "formation": lineup.get("formation") or "",
        "players": players,
    }


async def fetch_lineup_details(external_id: str) -> dict | None:
    """
    Returns {"home": {team, formation, players[]}, "away": {...}} or None.
    Either side may be missing if that team's lineup hasn't been posted yet.
    """
    if not settings.apifootball_api_key or external_id.startswith("mock_"):
        return None

    now = time.time()
    cached = _lineup_details_cache.get(external_id)
    if cached and now - cached[0] < _LINEUP_DETAILS_TTL:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            fixture_r, lineups_r = await asyncio.gather(
                client.get(f"{_BASE_URL}/fixtures", headers=_HEADERS(),
                           params={"id": external_id}),
                client.get(f"{_BASE_URL}/fixtures/lineups", headers=_HEADERS(),
                           params={"fixture": external_id}),
            )
        fixture_data = _r(fixture_r)
        lineups_data = _r(lineups_r)
        if not fixture_data or not lineups_data:
            _lineup_details_cache[external_id] = (now, None)
            return None

        home_id = fixture_data[0]["teams"]["home"]["id"]
        away_id = fixture_data[0]["teams"]["away"]["id"]
        result: dict = {"home": None, "away": None}
        for lineup in lineups_data:
            team_id = (lineup.get("team") or {}).get("id")
            payload = _lineup_team_payload(lineup)
            if not payload["players"]:
                continue
            if team_id == home_id:
                result["home"] = payload
            elif team_id == away_id:
                result["away"] = payload
        if result["home"] is None and result["away"] is None:
            _lineup_details_cache[external_id] = (now, None)
            return None
    except Exception:
        _lineup_details_cache[external_id] = (now, None)
        return None

    _lineup_details_cache[external_id] = (now, result)
    return result
