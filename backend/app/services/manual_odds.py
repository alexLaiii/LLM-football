"""TEMPORARY: in-memory manual odds overrides for local testing.

When an override is set for a fixture (by external_id), those odds are used
*no matter what* — they take precedence over the bookmaker feed for both AI
predictions and betting. In-memory only: cleared on restart and not shared across
processes (fine for a single local backend). Delete this module and its usages
to revert.
"""

_OVERRIDES: dict[str, dict] = {}

# Only these exact accounts may set manual odds (case-sensitive).
MANUAL_ODDS_USERS = {"Alex", "alex_real", "Kim"}


def is_manual_odds_user(username: str | None) -> bool:
    return username in MANUAL_ODDS_USERS


def set_manual_odds(external_id: str, odds: dict) -> None:
    _OVERRIDES[external_id] = {
        "home": float(odds["home"]),
        "draw": float(odds["draw"]),
        "away": float(odds["away"]),
    }


def get_manual_odds(external_id: str) -> dict | None:
    return _OVERRIDES.get(external_id)


def clear_manual_odds(external_id: str) -> None:
    _OVERRIDES.pop(external_id, None)
