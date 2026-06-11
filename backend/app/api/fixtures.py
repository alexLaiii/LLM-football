from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.fixture import Fixture
from app.models.team import Team
from app.schemas import FixtureOut, FixtureWithPredictions
from app.services.football_api import fetch_lineup_available, fetch_lineup_details, fetch_upcoming_fixtures
from app.services.odds_snapshot import fixture_odds_for_betting

router = APIRouter(prefix="/fixtures", tags=["fixtures"])


def _upsert_team(db: Session, team_id: int | None, name: str, crest: str | None) -> None:
    if not team_id:
        return
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        db.add(Team(id=team_id, name=name, crest=crest))
    elif crest and not team.crest:
        team.crest = crest


@router.get("/", response_model=list[FixtureOut])
def list_fixtures(include_past: bool = False, db: Session = Depends(get_db)):
    q = db.query(Fixture)
    if not include_past:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=90)
        q = q.filter(Fixture.kickoff_at >= cutoff)
    return q.order_by(Fixture.kickoff_at).all()



@router.get("/{fixture_id}", response_model=FixtureWithPredictions)
def get_fixture(fixture_id: int, db: Session = Depends(get_db)):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    return fixture


@router.get("/{fixture_id}/odds")
async def get_fixture_odds(fixture_id: int, db: Session = Depends(get_db)):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    return await fixture_odds_for_betting(fixture, db)


@router.get("/{fixture_id}/lineup-available")
async def get_fixture_lineup_available(fixture_id: int, db: Session = Depends(get_db)):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    return {"available": await fetch_lineup_available(fixture.external_id)}


@router.get("/{fixture_id}/lineup")
async def get_fixture_lineup(fixture_id: int, db: Session = Depends(get_db)):
    fixture = db.query(Fixture).filter(Fixture.id == fixture_id).first()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    return await fetch_lineup_details(fixture.external_id) or {"home": None, "away": None}


@router.post("/sync", response_model=list[FixtureOut])
async def sync_fixtures(db: Session = Depends(get_db)):
    """Pull upcoming fixtures from API-Football and store any new ones."""
    raw = await fetch_upcoming_fixtures()
    added = []
    for f in raw:
        # Upsert teams first so FK references are valid
        _upsert_team(db, f.get("home_team_id"), f["home_team"], f.get("home_team_crest"))
        _upsert_team(db, f.get("away_team_id"), f["away_team"], f.get("away_team_crest"))

        exists = db.query(Fixture).filter(Fixture.external_id == f["external_id"]).first()
        if not exists:
            fixture = Fixture(
                external_id=f["external_id"],
                home_team=f["home_team"],
                away_team=f["away_team"],
                home_team_id=f.get("home_team_id"),
                away_team_id=f.get("away_team_id"),
                league=f["league"],
                kickoff_at=datetime.fromisoformat(f["kickoff_at"]),
            )
            db.add(fixture)
            added.append(fixture)
        else:
            # Backfill team IDs if missing from a previous sync
            if exists.home_team_id is None and f.get("home_team_id"):
                exists.home_team_id = f["home_team_id"]
                exists.away_team_id = f.get("away_team_id")

    db.commit()
    for f in added:
        db.refresh(f)
    return added
