import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.models.prediction_blind import BlindPrediction
from app.models.user import User
from app.schemas import PredictionOut
from app.services.ai.orchestrator import predict_all_in_background, run_predictions
from app.services.auth import get_current_user
from app.services.manual_odds import is_manual_odds_user, set_manual_odds

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/", response_model=list[PredictionOut])
def list_predictions(db: Session = Depends(get_db)):
    return (
        db.query(Prediction)
        .join(Fixture)
        .order_by(Fixture.kickoff_at.desc())
        .all()
    )


@router.post("/request/{fixture_id}", response_model=list[PredictionOut])
async def request_predictions(fixture_id: int, db: Session = Depends(get_db)):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    # Idempotent: generates only the missing model/mode combinations and returns
    # all predictions for the fixture. A fixture with all combinations already
    # present is returned unchanged.
    return await run_predictions(fixture, db)


# TEMPORARY: manual-odds prediction trigger for local testing when the bookmaker
# feed has no line (e.g. close to kickoff). Remove this endpoint and the
# odds_override branch in the orchestrator to restore.
class ManualOddsInput(BaseModel):
    home: float
    draw: float
    away: float

    @field_validator("home", "draw", "away")
    @classmethod
    def _valid_decimal_odds(cls, value: float) -> float:
        if value <= 1.0:
            raise ValueError("Odds must be decimal odds greater than 1.0")
        return round(float(value), 2)


@router.post("/manual-odds/{fixture_id}")
async def request_predictions_manual_odds(
    fixture_id: int,
    body: ManualOddsInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """TEMPORARY: manual odds override, restricted to allow-listed accounts. The
    entered odds take precedence over the bookmaker feed *no matter what* — for
    both predictions and betting. Existing (unsettled) predictions for the fixture
    are cleared and regenerated with the manual odds; betting then uses them too.
    Runs in the background; poll /fixtures/{id} for results."""
    if not is_manual_odds_user(user.username):
        raise HTTPException(status_code=403, detail="Manual odds are not enabled for this account")

    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    if fixture.status == "finished":
        raise HTTPException(status_code=400, detail="Match is finished; predictions are settled")

    odds = {"home": body.home, "draw": body.draw, "away": body.away}
    set_manual_odds(fixture.external_id, odds)

    # Replace existing predictions so they're regenerated against the manual odds.
    db.query(Prediction).filter(Prediction.fixture_id == fixture.id).delete()
    db.query(BlindPrediction).filter(BlindPrediction.fixture_id == fixture.id).delete()
    db.commit()

    fixture_dict = {
        "external_id": fixture.external_id,
        "home_team": fixture.home_team,
        "away_team": fixture.away_team,
        "home_team_id": fixture.home_team_id,
        "away_team_id": fixture.away_team_id,
        "league": fixture.league,
        "kickoff_at": fixture.kickoff_at,
    }
    asyncio.create_task(
        predict_all_in_background(fixture.id, fixture_dict, fixture.external_id, odds_override=odds)
    )
    return {"status": "started", "odds": odds}
