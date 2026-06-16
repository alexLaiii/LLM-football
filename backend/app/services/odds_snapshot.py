import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.services.odds_api import fetch_odds, fetch_live_odds, is_real_odds

_SNAPSHOT_ODDS_RE = re.compile(r"^odds_(home|draw|away):\s*([0-9]+(?:\.[0-9]+)?)$", re.MULTILINE)


def _is_started(kickoff_at: datetime | None) -> bool:
    if kickoff_at is None:
        return False
    ko = kickoff_at if kickoff_at.tzinfo else kickoff_at.replace(tzinfo=timezone.utc)
    return ko <= datetime.now(timezone.utc)


def _odds_from_prompt_snapshot(prompt_snapshot: str | None) -> dict | None:
    if not prompt_snapshot:
        return None
    odds = {
        match.group(1): float(match.group(2))
        for match in _SNAPSHOT_ODDS_RE.finditer(prompt_snapshot)
    }
    return odds if set(odds) == {"home", "draw", "away"} else None


def prediction_odds_snapshot(fixture_id: int, db: Session) -> dict | None:
    predictions = (
        db.query(Prediction)
        .filter(Prediction.fixture_id == fixture_id)
        .order_by(Prediction.created_at, Prediction.id)
        .all()
    )
    for prediction in predictions:
        if (
            prediction.odds_home is not None
            and prediction.odds_draw is not None
            and prediction.odds_away is not None
        ):
            return {
                "home": round(float(prediction.odds_home), 2),
                "draw": round(float(prediction.odds_draw), 2),
                "away": round(float(prediction.odds_away), 2),
                "kickoff_at": None,
            }
        odds = _odds_from_prompt_snapshot(prediction.prompt_snapshot)
        if odds:
            return {**odds, "kickoff_at": None}
    return None


async def fixture_odds_for_betting(fixture: Fixture, db: Session) -> dict:
    odds = prediction_odds_snapshot(fixture.id, db)
    if odds is None:
        odds = await fetch_odds(
            fixture.external_id,
            home_team=fixture.home_team,
            away_team=fixture.away_team,
            league=fixture.league,
            kickoff_at=fixture.kickoff_at,
        )
    if is_real_odds(fixture.external_id, odds):
        return {**odds, "available": True, "live": False}

    # Prematch odds can vanish in the final minutes before kickoff (Bet365 pulls
    # the market just before the match goes in-play). In that pre-kickoff window
    # fall back to live in-play odds — bettable, since the match hasn't started.
    # Once started we don't fetch — betting is closed anyway.
    if not fixture.external_id.startswith("mock_") and not _is_started(fixture.kickoff_at):
        live = await fetch_live_odds(fixture.home_team, fixture.away_team)
        if live is not None:
            return {**live, "available": True, "live": True}

    return {**odds, "available": False, "live": False}
