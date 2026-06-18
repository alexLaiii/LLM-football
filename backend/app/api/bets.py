import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.models.prediction_blind import BlindPrediction
from app.models.user import User
from app.models.user_bet import UserBet
from app.schemas import (
    CompareEntry,
    CompareOut,
    CompareSummary,
    LeaderboardEntry,
    PredictionOut,
    UserBetInput,
    UserBetOut,
)
from app.services.ai.models import ALL_MODELS, ORIGINAL_MODELS, is_blind, label_for
from app.services.ai.orchestrator import predict_all_in_background, prediction_class
from app.services.auth import get_current_user
from app.services.odds_api import is_match_started
from app.services.odds_snapshot import fixture_odds_for_betting

router = APIRouter(prefix="/bets", tags=["bets"])

INITIAL_BANKROLL = 20_000.0
# Compare-to-AI is defined against the original five only (they live in the
# `predictions` table). The leaderboard additionally lists the blind five from
# the `blind_predictions` table; the client filters which population is shown.
_AI_MODELS = ORIGINAL_MODELS


def _user_bankroll(user_id: int, db: Session) -> float:
    settled_pl = db.query(func.coalesce(func.sum(UserBet.profit_loss), 0)).filter(
        UserBet.user_id == user_id,
        UserBet.status.in_(["won", "lost"]),
    ).scalar()
    pending_stakes = db.query(func.coalesce(func.sum(UserBet.stake), 0)).filter(
        UserBet.user_id == user_id,
        UserBet.status == "pending",
    ).scalar()
    return INITIAL_BANKROLL + float(settled_pl) - float(pending_stakes)


@router.get("/me/bankroll")
def my_bankroll(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"bankroll": round(_user_bankroll(user.id, db), 2)}


@router.get("/me", response_model=list[UserBetOut])
def list_my_bets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(UserBet)
        .join(Fixture, Fixture.id == UserBet.fixture_id)
        .filter(UserBet.user_id == user.id)
        .order_by(Fixture.kickoff_at.desc())
        .all()
    )


@router.get("/me/by-fixture/{fixture_id}", response_model=UserBetOut | None)
def my_bet_for_fixture(
    fixture_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(UserBet)
        .filter(UserBet.user_id == user.id, UserBet.fixture_id == fixture_id)
        .first()
    )


@router.post("/{fixture_id}", response_model=UserBetOut)
async def place_bet(
    fixture_id: int,
    body: UserBetInput,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    if is_match_started(fixture.kickoff_at):
        raise HTTPException(status_code=400, detail="Betting is closed: the match has already started")

    existing = (
        db.query(UserBet)
        .filter(UserBet.user_id == user.id, UserBet.fixture_id == fixture_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="You have already bet on this match")

    if body.stake <= 0:
        raise HTTPException(status_code=400, detail="Stake must be positive")

    bankroll = _user_bankroll(user.id, db)
    if body.stake > bankroll:
        raise HTTPException(
            status_code=400,
            detail=f"Stake ${body.stake:.2f} exceeds available bankroll ${bankroll:.2f}",
        )

    odds_data = await fixture_odds_for_betting(fixture, db)
    if not odds_data.get("available"):
        raise HTTPException(status_code=400, detail="Odds are not available for this match yet")
    bet_odds = round(float(odds_data.get(body.bet_on, 2.5)), 2)

    bet = UserBet(
        user_id=user.id,
        fixture_id=fixture.id,
        bet_on=body.bet_on,
        stake=round(body.stake, 2),
        odds=bet_odds,
    )
    db.add(bet)
    db.commit()
    db.refresh(bet)

    # Trigger AI predictions only when some model/mode combination is still
    # missing. The background task itself generates only the gaps, so this is
    # safe for fixtures with just the original five (it backfills the blind five)
    # and a no-op once all ten exist.
    existing_models = {
        name for (name,) in
        db.query(Prediction.model_name).filter(Prediction.fixture_id == fixture.id).all()
    } | {
        name for (name,) in
        db.query(BlindPrediction.model_name).filter(BlindPrediction.fixture_id == fixture.id).all()
    }
    if not set(ALL_MODELS).issubset(existing_models):
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
            predict_all_in_background(fixture.id, fixture_dict, fixture.external_id)
        )

    return bet


def _recent_form(settled, n: int = 5) -> list[str]:
    """Last up to n settled results, chronological (oldest → newest), as 'W'/'L'."""
    dated = [r for r in settled if r.settled_at is not None]
    dated.sort(key=lambda r: r.settled_at, reverse=True)
    recent = list(reversed(dated[:n]))
    return ["W" if r.status == "won" else "L" for r in recent]


# Short in-process cache so frequent polling (many tabs) doesn't recompute the
# whole board on every request. Stale-by-at-most TTL seconds is fine for a board
# that only changes on settlement (~10 min) or a new bet.
_LB_CACHE: dict = {"at": 0.0, "data": None}
_LB_TTL = 45.0


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(db: Session = Depends(get_db)):
    now = time.monotonic()
    if _LB_CACHE["data"] is not None and now - _LB_CACHE["at"] < _LB_TTL:
        return _LB_CACHE["data"]

    entries: list[LeaderboardEntry] = []

    # AI models — originals from `predictions`, blind from `blind_predictions`.
    for model in ALL_MODELS:
        Model = prediction_class(model)
        rows = db.query(Model).filter(Model.model_name == model).all()
        settled = [r for r in rows if r.status in ("won", "lost")]
        won = sum(1 for r in settled if r.status == "won")
        lost = len(settled) - won
        total_pl = sum(r.profit_loss or 0.0 for r in settled)
        total_staked = sum(r.stake for r in settled)
        pending_staked = sum(r.stake for r in rows if r.status == "pending")
        entries.append(LeaderboardEntry(
            kind="ai",
            name=model,
            display_name=label_for(model),
            blind=is_blind(model),
            bankroll=round(INITIAL_BANKROLL + total_pl - pending_staked, 2),
            total_bets=len(rows),
            won=won,
            lost=lost,
            pending=sum(1 for r in rows if r.status == "pending"),
            win_rate=round(won / len(settled), 3) if settled else 0.0,
            roi=round(total_pl / total_staked, 3) if total_staked else 0.0,
            total_profit_loss=round(total_pl, 2),
            recent_form=_recent_form(settled),
        ))

    # Users
    for user in db.query(User).all():
        rows = db.query(UserBet).filter(UserBet.user_id == user.id).all()
        settled = [r for r in rows if r.status in ("won", "lost")]
        won = sum(1 for r in settled if r.status == "won")
        lost = len(settled) - won
        total_pl = sum(r.profit_loss or 0.0 for r in settled)
        total_staked = sum(r.stake for r in settled)
        pending_staked = sum(r.stake for r in rows if r.status == "pending")
        entries.append(LeaderboardEntry(
            kind="user",
            name=user.username,
            display_name=user.username,
            bankroll=round(INITIAL_BANKROLL + total_pl - pending_staked, 2),
            total_bets=len(rows),
            won=won,
            lost=lost,
            pending=sum(1 for r in rows if r.status == "pending"),
            win_rate=round(won / len(settled), 3) if settled else 0.0,
            roi=round(total_pl / total_staked, 3) if total_staked else 0.0,
            total_profit_loss=round(total_pl, 2),
            recent_form=_recent_form(settled),
        ))

    _LB_CACHE["data"] = entries
    _LB_CACHE["at"] = now
    return entries


@router.get("/me/compare", response_model=CompareOut)
def compare_me_to_ai(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bets = (
        db.query(UserBet)
        .join(Fixture, Fixture.id == UserBet.fixture_id)
        .filter(UserBet.user_id == user.id)
        .order_by(Fixture.kickoff_at.desc())
        .all()
    )

    entries: list[CompareEntry] = []
    user_pl_total = 0.0
    ai_pl_total = 0.0
    ai_settled_count = 0
    ai_won_count = 0
    user_settled = 0
    user_won = 0

    for bet in bets:
        fixture = db.query(Fixture).filter(Fixture.id == bet.fixture_id).first()
        if not fixture:
            continue
        # Compare-to-AI is the original five only; they live in `predictions`,
        # so blind predictions (separate table) are naturally excluded.
        ai_preds = (
            db.query(Prediction)
            .filter(Prediction.fixture_id == bet.fixture_id)
            .all()
        )
        entries.append(CompareEntry(
            fixture_id=fixture.id,
            home_team=fixture.home_team,
            away_team=fixture.away_team,
            league=fixture.league,
            kickoff_at=fixture.kickoff_at,
            result=fixture.result,
            user_bet=UserBetOut.model_validate(bet),
            ai_predictions=[PredictionOut.model_validate(p) for p in ai_preds],
        ))

        if bet.status in ("won", "lost"):
            user_settled += 1
            user_pl_total += bet.profit_loss or 0.0
            if bet.status == "won":
                user_won += 1
        for p in ai_preds:
            if p.status in ("won", "lost"):
                ai_settled_count += 1
                ai_pl_total += p.profit_loss or 0.0
                if p.status == "won":
                    ai_won_count += 1

    summary = CompareSummary(
        user_pl=round(user_pl_total, 2),
        ai_pl=round(ai_pl_total / len(_AI_MODELS), 2) if entries else 0.0,
        user_win_rate=round(user_won / user_settled, 3) if user_settled else 0.0,
        ai_win_rate=round(ai_won_count / ai_settled_count, 3) if ai_settled_count else 0.0,
        matches_bet=len(entries),
    )
    return CompareOut(summary=summary, entries=entries)
