import re

from sqlalchemy.orm import Session

from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.services.odds_api import fetch_odds

_SNAPSHOT_ODDS_RE = re.compile(r"^odds_(home|draw|away):\s*([0-9]+(?:\.[0-9]+)?)$", re.MULTILINE)


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
    frozen = prediction_odds_snapshot(fixture.id, db)
    if frozen:
        return frozen
    return await fetch_odds(
        fixture.external_id,
        home_team=fixture.home_team,
        away_team=fixture.away_team,
        league=fixture.league,
        kickoff_at=fixture.kickoff_at,
    )
