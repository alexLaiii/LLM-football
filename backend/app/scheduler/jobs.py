from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.models.prediction_blind import BlindPrediction
from app.models.user_bet import UserBet
from app.services.football_api import fetch_result, fetch_upcoming_fixtures


def _settle_pending(db, Model, fixture_id, outcome, now):
    """Settle every pending wager of one kind (Prediction / BlindPrediction /
    UserBet) for a fixture. All three share bet_on/status/stake/odds/profit_loss."""
    for row in db.query(Model).filter(
        Model.fixture_id == fixture_id,
        Model.status == "pending",
    ).all():
        if row.bet_on == outcome:
            row.status = "won"
            row.profit_loss = round(row.stake * (row.odds - 1), 2)
        else:
            row.status = "lost"
            row.profit_loss = -row.stake
        row.settled_at = now


async def job_sync_fixtures():
    """Weekly: pull upcoming fixtures and store new ones."""
    db = SessionLocal()
    try:
        raw = await fetch_upcoming_fixtures()
        for f in raw:
            exists = db.query(Fixture).filter(Fixture.external_id == f["external_id"]).first()
            if not exists:
                db.add(Fixture(
                    external_id=f["external_id"],
                    home_team=f["home_team"],
                    away_team=f["away_team"],
                    league=f["league"],
                    kickoff_at=datetime.fromisoformat(f["kickoff_at"]),
                ))
        db.commit()
    finally:
        db.close()


async def job_settle_matches():
    """Hourly: settle bets for matches that have finished."""
    db = SessionLocal()
    try:
        pending = (
            db.query(Fixture)
            .filter(
                Fixture.status == "scheduled",
                Fixture.kickoff_at < datetime.now(timezone.utc),
            )
            .all()
        )
        for fixture in pending:
            result = await fetch_result(fixture.external_id)
            if result is None:
                continue

            fixture.status = "finished"
            fixture.result = result["outcome"]
            fixture.home_goals = result.get("home_goals")
            fixture.away_goals = result.get("away_goals")

            now = datetime.now(timezone.utc)
            outcome = result["outcome"]
            _settle_pending(db, Prediction, fixture.id, outcome, now)
            _settle_pending(db, BlindPrediction, fixture.id, outcome, now)
            _settle_pending(db, UserBet, fixture.id, outcome, now)

            db.commit()
    finally:
        db.close()
