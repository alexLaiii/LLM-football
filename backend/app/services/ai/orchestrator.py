import asyncio
import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.config import settings
from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.models.team_elo import TeamElo
from app.services.ai.claude import ClaudePredictor
from app.services.ai.gemini import GeminiPredictor
from app.services.ai.gpt5 import GPT5Predictor
from app.services.ai.grok import GrokPredictor
from app.services.ai.deepseek import DeepSeekPredictor
from app.services.football_api import fetch_match_context
from app.services.lineup_analyzer import analyze_lineups
from app.services.odds_api import fetch_odds

PREDICTORS = [
    ClaudePredictor(),
    GPT5Predictor(),
    GeminiPredictor(),
    GrokPredictor(),
    DeepSeekPredictor(),
]
INITIAL_BANKROLL = 20_000.0


def get_bankroll(model_name: str, db: Session) -> float:
    settled_pl = db.query(func.coalesce(func.sum(Prediction.profit_loss), 0)).filter(
        Prediction.model_name == model_name,
        Prediction.status.in_(["won", "lost"]),
    ).scalar()
    pending_stakes = db.query(func.coalesce(func.sum(Prediction.stake), 0)).filter(
        Prediction.model_name == model_name,
        Prediction.status == "pending",
    ).scalar()
    return INITIAL_BANKROLL + float(settled_pl) - float(pending_stakes)


def _inject_team_ratings(match_context: dict, fixture_dict: dict, db: Session) -> None:
    """For World Cup fixtures, add home/away Elo and FIFA ranking from the team_elo table
    when available. Skips silently if the league isn't World Cup or the value is missing, so
    predictors fall back to their own judgement of squad strength."""
    if fixture_dict.get("league") != "World Cup":
        return
    for side in ("home", "away"):
        team_id = fixture_dict.get(f"{side}_team_id")
        if not team_id:
            continue
        row = db.query(TeamElo).filter(TeamElo.team_id == team_id).first()
        if not row:
            continue
        if row.elo is not None:
            match_context[f"{side}_elo"] = row.elo
        if row.fifa_rank is not None:
            match_context[f"{side}_fifa_rank"] = row.fifa_rank


def _build_prompt_snapshot(fixture_dict: dict, match_context: dict, odds: dict, external_id: str) -> str:
    is_mock = not settings.apifootball_api_key or external_id.startswith("mock_")
    label = "MOCK" if is_mock else "REAL"
    data_lines = [f"USED DATA ({label}):"]
    data_lines.append(f"match: {fixture_dict['home_team']} vs {fixture_dict['away_team']}")
    data_lines.append(f"league: {fixture_dict['league']}")
    data_lines.append(f"odds_home: {odds['home']:.2f}")
    data_lines.append(f"odds_draw: {odds['draw']:.2f}")
    data_lines.append(f"odds_away: {odds['away']:.2f}")
    for key, val in match_context.items():
        if val is None:
            data_lines.append(f"{key}: unavailable")
            continue
        if isinstance(val, dict):
            for subkey, subval in val.items():
                if subkey == "games":
                    continue
                data_lines.append(f"{key}_{subkey}: {subval}")
        else:
            data_lines.append(f"{key}: {val}")
    return "\n".join(data_lines)


def _log_user_message(fixture_dict: dict, match_context: dict, odds: dict) -> None:
    """Log the exact user_message JSON that each AI model will receive."""
    user_message = {
        "match": f"{fixture_dict['home_team']} vs {fixture_dict['away_team']}",
        "league": fixture_dict["league"],
        "odds": {"home": odds["home"], "draw": odds["draw"], "away": odds["away"]},
        "context": match_context,
    }
    logger.info(
        "AI user_message for fixture %s:\n%s",
        fixture_dict.get("external_id", "?"),
        json.dumps(user_message, indent=2, ensure_ascii=False),
    )


async def run_single_prediction(
    predictor,
    fixture_id: int,
    fixture_dict: dict,
    match_context: dict,
    odds: dict,
    bankroll: float,
    prompt_snapshot: str,
) -> None:
    """Run one AI model and save its result immediately when done."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        result = await predictor.predict(fixture_dict, match_context, odds, bankroll)
        prediction = Prediction(
            fixture_id=fixture_id,
            model_name=result.model_name,
            home_prob=result.home_prob,
            draw_prob=result.draw_prob,
            away_prob=result.away_prob,
            bet_on=result.bet_on,
            confidence=result.confidence,
            expected_value=result.expected_value,
            stake=result.stake,
            odds=result.odds,
            odds_home=odds["home"],
            odds_draw=odds["draw"],
            odds_away=odds["away"],
            reasoning=result.reasoning,
            prompt_snapshot=prompt_snapshot,
            home_value_score=result.home_value_score,
            draw_value_score=result.draw_value_score,
            away_value_score=result.away_value_score,
        )
        db.add(prediction)
        db.commit()
    except Exception:
        pass
    finally:
        db.close()


async def predict_all_in_background(
    fixture_id: int,
    fixture_dict: dict,
    external_id: str,
) -> None:
    """Fetch context + odds once, then run all AI models in parallel.
    Each model saves to DB as soon as it finishes — no waiting for slow models."""
    from app.database import SessionLocal
    try:
        match_context, odds, lineup_summary = await asyncio.gather(
            fetch_match_context(external_id),
            fetch_odds(
                external_id,
                home_team=fixture_dict["home_team"],
                away_team=fixture_dict["away_team"],
                league=fixture_dict["league"],
                kickoff_at=fixture_dict.get("kickoff_at"),
            ),
            analyze_lineups(external_id),
        )
        if lineup_summary:
            match_context["lineup_summary"] = lineup_summary

        db = SessionLocal()
        try:
            _inject_team_ratings(match_context, fixture_dict, db)
            bankrolls = {p.name: get_bankroll(p.name, db) for p in PREDICTORS}
        finally:
            db.close()

        _log_user_message(fixture_dict, match_context, odds)
        prompt_snapshot = _build_prompt_snapshot(fixture_dict, match_context, odds, external_id)

        await asyncio.gather(*[
            run_single_prediction(p, fixture_id, fixture_dict, match_context, odds, bankrolls[p.name], prompt_snapshot)
            for p in PREDICTORS
        ])
    except Exception:
        pass


async def run_predictions(fixture: Fixture, db: Session) -> list[Prediction]:
    """Run all AI predictions in parallel and return them (used by /predictions/request endpoint)."""
    fixture_dict = {
        "external_id": fixture.external_id,
        "home_team": fixture.home_team,
        "away_team": fixture.away_team,
        "home_team_id": fixture.home_team_id,
        "away_team_id": fixture.away_team_id,
        "league": fixture.league,
        "kickoff_at": fixture.kickoff_at,
    }

    match_context, odds, lineup_summary = await asyncio.gather(
        fetch_match_context(fixture.external_id),
        fetch_odds(
            fixture.external_id,
            home_team=fixture_dict["home_team"],
            away_team=fixture_dict["away_team"],
            league=fixture_dict["league"],
            kickoff_at=fixture_dict["kickoff_at"],
        ),
        analyze_lineups(fixture.external_id),
    )
    if lineup_summary:
        match_context["lineup_summary"] = lineup_summary

    _inject_team_ratings(match_context, fixture_dict, db)
    _log_user_message(fixture_dict, match_context, odds)
    prompt_snapshot = _build_prompt_snapshot(fixture_dict, match_context, odds, fixture.external_id)
    bankrolls = {p.name: get_bankroll(p.name, db) for p in PREDICTORS}

    results = await asyncio.gather(
        *[p.predict(fixture_dict, match_context, odds, bankrolls[p.name]) for p in PREDICTORS]
    )

    predictions = [
        Prediction(
            fixture_id=fixture.id,
            model_name=r.model_name,
            home_prob=r.home_prob,
            draw_prob=r.draw_prob,
            away_prob=r.away_prob,
            bet_on=r.bet_on,
            confidence=r.confidence,
            expected_value=r.expected_value,
            stake=r.stake,
            odds=r.odds,
            odds_home=odds["home"],
            odds_draw=odds["draw"],
            odds_away=odds["away"],
            reasoning=r.reasoning,
            prompt_snapshot=prompt_snapshot,
            home_value_score=r.home_value_score,
            draw_value_score=r.draw_value_score,
            away_value_score=r.away_value_score,
        )
        for r in results
    ]

    db.add_all(predictions)
    db.commit()
    for p in predictions:
        db.refresh(p)
    return predictions
