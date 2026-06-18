from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import app.models  # noqa: F401 — registers models with Base before create_all
from app.api import auth, bets, fixtures, j_tracker, performance, predictions
from app.config import settings
from app.database import Base, engine
from app.rate_limit import InMemoryRateLimitMiddleware
from app.scheduler.jobs import job_settle_matches, job_sync_fixtures

scheduler = AsyncIOScheduler()


def _migrate():
    """Add new columns to existing tables without dropping data."""
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS teams "
            "(id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL)"
        ))
        for col in ("home_team_id", "away_team_id"):
            conn.execute(text(
                f"ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS {col} INTEGER"
            ))
        for col in ("odds_home", "odds_draw", "odds_away"):
            conn.execute(text(
                f"ALTER TABLE predictions ADD COLUMN IF NOT EXISTS {col} FLOAT"
            ))
        conn.execute(text(
            "ALTER TABLE teams ADD COLUMN IF NOT EXISTS crest VARCHAR(500)"
        ))
        # Idempotency backstop: at most one prediction per (fixture, model/mode),
        # so concurrent triggers can't create duplicate rows. Wrapped so a legacy
        # table with pre-existing duplicates can't block startup.
        try:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_predictions_fixture_model "
                "ON predictions (fixture_id, model_name)"
            ))
        except Exception:
            pass
        conn.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    _migrate()
    scheduler.add_job(job_sync_fixtures, "cron", day_of_week="mon", hour=6)
    scheduler.add_job(job_settle_matches, "interval", minutes=10)
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="AI Football Predictor API", lifespan=lifespan)

app.add_middleware(InMemoryRateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fixtures.router)
app.include_router(predictions.router)
app.include_router(performance.router)
app.include_router(j_tracker.router)
app.include_router(auth.router)
app.include_router(bets.router)


@app.get("/health")
def health():
    return {"status": "ok"}
