"""PulseScore odds integration (Bet365).

Prefer normalized v3 enhanced prices when available; fall back to the normal
v3 full-time result market, then legacy v2/default odds.
"""
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from app.config import settings

_V2_BASE_URL = "https://api.pulsescore.net/api/v2/bet365"
_V3_BASE_URL = "https://api.pulsescore.net/api/v3/bet365"
_HEADERS = lambda: {"X-Secret": settings.pulsescore_api_key}
_CACHE_TTL = 300  # seconds
_LIVE_CACHE_TTL = 30  # live odds move fast; short cache, just enough to share across fixtures
_KICKOFF_MATCH_WINDOW = timedelta(hours=18)

# Map our league names (from API-Football) to PulseScore leagueName values.
_V2_LEAGUE_MAP = {
    "Premier League": "England Premier League",
    "La Liga": "Spain La Liga",
    "Bundesliga": "Germany Bundesliga",
    "Ligue 1": "France Ligue 1",
    "Serie A": "Italy Serie A",
    "UEFA Champions League": "UEFA Champions League",
    "UEFA Europa League": "UEFA Europa League",
    "World Cup": "World Cup 2026",
}

# v3 /leagues is availability-scoped. Only add exact names verified from
# /api/v3/bet365/leagues; leagues absent here should fall back to v2.
_V3_LEAGUE_MAP = {
    "World Cup": "World Cup 2026||World Cup 2026",
}

# {ps_league_name: (fetched_at_timestamp, [events])}
_v2_league_cache: dict[str, tuple[float, list]] = {}
_v3_league_cache: dict[str, tuple[float, list]] = {}
_live_events_cache: dict[str, tuple[float, list]] = {}

_MOCK_ODDS: dict[str, dict] = {
    "mock_001": {"home": 2.10, "draw": 3.40, "away": 3.60, "kickoff_at": None},
    "mock_002": {"home": 2.30, "draw": 3.20, "away": 3.10, "kickoff_at": None},
    "mock_003": {"home": 1.85, "draw": 3.60, "away": 4.20, "kickoff_at": None},
    "mock_004": {"home": 1.95, "draw": 3.50, "away": 3.80, "kickoff_at": None},
    "mock_005": {"home": 2.50, "draw": 3.10, "away": 2.90, "kickoff_at": None},
}
_DEFAULT_ODDS = {"home": 2.50, "draw": 3.20, "away": 2.80, "kickoff_at": None}


def is_real_odds(external_id: str, odds: dict | None) -> bool:
    """True only for genuine bookmaker odds — not the mock_* demo fixtures nor
    the _DEFAULT_ODDS placeholder returned when real odds can't be fetched."""
    if odds is None or external_id.startswith("mock_"):
        return False
    triple = (odds.get("home"), odds.get("draw"), odds.get("away"))
    return triple != (_DEFAULT_ODDS["home"], _DEFAULT_ODDS["draw"], _DEFAULT_ODDS["away"])


async def _fetch_live_soccer_events() -> list:
    """All in-play soccer events (markets inline), cached briefly."""
    cached = _live_events_cache.get("soccer")
    if cached and time.monotonic() - cached[0] < _LIVE_CACHE_TTL:
        return cached[1]
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_V3_BASE_URL}/live-events",
            headers=_HEADERS(),
            params={"sport": "soccer", "limit": 200},
        )
        if r.status_code != 200:
            return []
        data = r.json()
        events = data.get("events") if isinstance(data, dict) else data
        if not isinstance(events, list):
            return []
        _live_events_cache["soccer"] = (time.monotonic(), events)
        return events


def _parse_live_ftr(event: dict) -> dict | None:
    """Extract the live full-time 1X2 from an in-play event's 'Fulltime Result'
    market (labeled 'OTHER' in the live feed, unlike the prematch 'MATCH_RESULT')."""
    for market in event.get("markets", []):
        if (market.get("rawName") or "").strip().lower() != "fulltime result":
            continue
        result = {}
        for selection in market.get("selections", []):
            outcome = selection.get("canonicalOutcome")
            odds = selection.get("odds")
            if outcome in ("HOME", "DRAW", "AWAY") and odds:
                result[outcome.lower()] = round(float(odds), 2)
        if set(result) == {"home", "draw", "away"}:
            return {**result, "kickoff_at": None}
    return None


async def fetch_live_odds(home_team: str, away_team: str) -> dict | None:
    """Live in-play full-time 1X2 for a match, or None if it isn't currently live.
    Used as a display-only fallback when prematch odds are gone (e.g. after kickoff)."""
    if not settings.pulsescore_api_key or not home_team or not away_team:
        return None
    for event in await _fetch_live_soccer_events():
        if _names_match(event.get("home", ""), home_team) and _names_match(event.get("away", ""), away_team):
            return _parse_live_ftr(event)
    return None


async def fetch_odds(
    external_id: str,
    home_team: str = "",
    away_team: str = "",
    league: str = "",
    kickoff_at: datetime | str | None = None,
) -> dict:
    """Returns {"home": float, "draw": float, "away": float, "kickoff_at": str|None} from Bet365."""
    if not settings.pulsescore_api_key or external_id.startswith("mock_"):
        return _MOCK_ODDS.get(external_id, _DEFAULT_ODDS)

    if not home_team or not away_team:
        return _DEFAULT_ODDS

    fixture_kickoff = _parse_datetime(kickoff_at)

    v3_league_name = _V3_LEAGUE_MAP.get(league)
    if v3_league_name:
        events = await _fetch_v3_league_events(v3_league_name)
        for event in events:
            if _event_matches(event, home_team, away_team, fixture_kickoff, source="v3"):
                return _parse_v3_odds(event)

    v2_league_name = _V2_LEAGUE_MAP.get(league)
    if not v2_league_name:
        return _DEFAULT_ODDS

    events = await _fetch_v2_league_events(v2_league_name)
    for event in events:
        if _event_matches(event, home_team, away_team, fixture_kickoff, source="v2"):
            return _parse_v2_odds(event, event.get("home", ""), event.get("away", ""))

    return _DEFAULT_ODDS


async def _fetch_v3_league_events(league_name: str) -> list:
    cached = _v3_league_cache.get(league_name)
    if cached and time.monotonic() - cached[0] < _CACHE_TTL:
        return cached[1]

    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_V3_BASE_URL}/leagues/{quote(league_name, safe='')}/events",
            headers=_HEADERS(),
        )
        if r.status_code != 200:
            return []
        data = r.json()
        events = data.get("events") if isinstance(data, dict) else data
        if not isinstance(events, list):
            return []
        _v3_league_cache[league_name] = (time.monotonic(), events)
        return events


async def _fetch_v2_league_events(league_name: str) -> list:
    """Fetch v2 events for a league, using a cache to avoid rate limits."""
    cached = _v2_league_cache.get(league_name)
    if cached and time.monotonic() - cached[0] < _CACHE_TTL:
        return cached[1]

    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_V2_BASE_URL}/events",
            headers=_HEADERS(),
            params={"league": league_name},
        )
        if r.status_code != 200:
            return []
        events = r.json()
        if not isinstance(events, list):
            return []
        _v2_league_cache[league_name] = (time.monotonic(), events)
        return events


_STRIP = {"fc", "afc", "cf", "sc"}
_WEAK_MATCH_TOKENS = {
    "athletic",
    "city",
    "club",
    "east",
    "north",
    "real",
    "south",
    "sporting",
    "united",
    "west",
}

def _names_match(a: str, b: str) -> bool:
    def tokens(name: str) -> set[str]:
        words = re.findall(r"[a-z0-9]+", name.lower())
        return {w for w in words if w not in _STRIP and len(w) >= 3}

    a_tok = tokens(a)
    b_tok = tokens(b)
    if not a_tok or not b_tok:
        return False

    if a_tok == b_tok:
        return True

    shared = a_tok & b_tok
    strong_shared = shared - _WEAK_MATCH_TOKENS
    if strong_shared and (a_tok <= b_tok or b_tok <= a_tok):
        return True

    # Prefix match handles Man/Manchester, Nottm/Nottingham, etc. without
    # letting generic shared words like South/United/City decide the match.
    return any(
        wa not in _WEAK_MATCH_TOKENS
        and wb not in _WEAK_MATCH_TOKENS
        and (wa.startswith(wb) or wb.startswith(wa))
        for wa in a_tok
        for wb in b_tok
    )


def _parse_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_v2_bc_datetime(bc: str) -> datetime | None:
    try:
        return datetime.strptime(bc, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _event_kickoff(event: dict, source: str) -> datetime | None:
    if source == "v3":
        return _parse_datetime(event.get("startTime"))
    return _parse_v2_bc_datetime(event.get("bc", ""))


def _kickoff_matches(event_dt: datetime | None, fixture_dt: datetime | None) -> bool:
    if fixture_dt is None:
        return True
    if event_dt is None:
        return False
    return abs(event_dt - fixture_dt) <= _KICKOFF_MATCH_WINDOW


def _event_matches(
    event: dict,
    home_team: str,
    away_team: str,
    fixture_kickoff: datetime | None,
    source: str,
) -> bool:
    if not _kickoff_matches(_event_kickoff(event, source), fixture_kickoff):
        return False
    return (
        _names_match(event.get("home", ""), home_team)
        and _names_match(event.get("away", ""), away_team)
    )


def _parse_kickoff(bc: str) -> str | None:
    """Parse PulseScore bc field (YYYYMMDDHHMMSS) to ISO 8601 string in EDT (UTC-4)."""
    dt = _parse_v2_bc_datetime(bc)
    if dt is None:
        return None
    return dt.astimezone(timezone(timedelta(hours=-4))).isoformat()


def _parse_v3_odds(event: dict) -> dict:
    """Extract 1X2 odds, preferring Bet365 enhanced prices when present."""
    kickoff_at = event.get("startTime")
    candidates = []
    for market in event.get("markets", []):
        if market.get("canonicalMarket") != "MATCH_RESULT" or market.get("period") != "FULL_TIME":
            continue
        raw_name = str(market.get("rawName", ""))
        priority = 0 if "enhanced" in raw_name.lower() else 1 if raw_name == "Full Time Result" else 2
        result = {}
        for selection in market.get("selections", []):
            outcome = selection.get("canonicalOutcome")
            odds = selection.get("odds")
            if outcome in ("HOME", "DRAW", "AWAY") and odds:
                result[outcome.lower()] = round(float(odds), 2)
        if set(result) == {"home", "draw", "away"}:
            candidates.append((priority, result))

    if not candidates:
        return {**_DEFAULT_ODDS, "kickoff_at": kickoff_at}

    _, odds = min(candidates, key=lambda candidate: candidate[0])
    return {**odds, "kickoff_at": kickoff_at}


def _parse_v2_odds(event: dict, home_name: str, away_name: str) -> dict:
    """Extract home/draw/away decimal odds from the legacy v2 Full Time Result market."""
    kickoff_at = _parse_kickoff(event.get("bc", ""))

    all_markets = []
    for tab in event.get("tabs", []):
        all_markets.extend(tab.get("mg", []))

    for market in all_markets:
        if market.get("name") != "Full Time Result":
            continue
        result = {}
        for ma in market.get("ma", []):
            for p in ma.get("pa", []):
                na = p.get("NA", "")
                decimal = p.get("decimal", "")
                if not decimal:
                    continue
                price = float(decimal)
                if _names_match(na, home_name):
                    result["home"] = round(price, 2)
                elif _names_match(na, away_name):
                    result["away"] = round(price, 2)
                elif na.lower() in ("draw", "tie"):
                    result["draw"] = round(price, 2)
        if "home" in result and "away" in result:
            result.setdefault("draw", _DEFAULT_ODDS["draw"])
            result["kickoff_at"] = kickoff_at
            return result

    return {**_DEFAULT_ODDS, "kickoff_at": kickoff_at}
