from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.prediction import Prediction
from app.models.prediction_blind import BlindPrediction
from app.schemas import ModelPerformance
from app.services.ai.models import ALL_MODELS, is_blind
from app.services.stats import grouped_stats, zero_stats

router = APIRouter(prefix="/performance", tags=["performance"])

# Original five plus their blind counterparts; each tracked independently,
# originals in `predictions` and blind in `blind_predictions`.
_MODELS = ALL_MODELS
_INITIAL_BANKROLL = 20_000.0


@router.get("/", response_model=list[ModelPerformance])
def get_performance(db: Session = Depends(get_db)):
    # Aggregated in the DB (one grouped query per table) so memory stays flat.
    pred_stats = grouped_stats(db, Prediction, Prediction.model_name)
    blind_stats = grouped_stats(db, BlindPrediction, BlindPrediction.model_name)
    results = []
    for model in _MODELS:
        stats = (blind_stats if is_blind(model) else pred_stats).get(model, zero_stats())
        settled = stats["won"] + stats["lost"]
        results.append(ModelPerformance(
            model_name=model,
            bankroll=round(_INITIAL_BANKROLL + stats["settled_pl"] - stats["pending_staked"], 2),
            total_bets=stats["total"],
            won=stats["won"],
            lost=stats["lost"],
            pending=stats["pending"],
            win_rate=round(stats["won"] / settled, 3) if settled else 0.0,
            roi=round(stats["settled_pl"] / stats["settled_staked"], 3) if stats["settled_staked"] else 0.0,
            total_profit_loss=round(stats["settled_pl"], 2),
        ))
    return results
