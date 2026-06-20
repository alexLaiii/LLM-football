import asyncio
import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.config import settings
from app.models.fixture import Fixture
from app.models.prediction import Prediction
from app.models.prediction_blind import BlindPrediction
from app.models.team_elo import TeamElo
from app.services.ai.claude import ClaudePredictor
from app.services.ai.gemini import GeminiPredictor
from app.services.ai.gpt5 import GPT5Predictor
from app.services.ai.grok import GrokPredictor
from app.services.ai.deepseek import DeepSeekPredictor
from app.services.ai.models import EXPECTED_PREDICTIONS_PER_FIXTURE, is_blind, missing_models
from app.services.football_api import fetch_match_context
from app.services.lineup_analyzer import analyze_lineups
from app.services.odds_api import fetch_odds_with_live_fallback

# One predictor instance per model/mode. Each blind predictor records itself as
# "<model>_blind" and never sees the odds; both modes otherwise share context.
_PROVIDERS = [ClaudePredictor, GPT5Predictor, GeminiPredictor, GrokPredictor, DeepSeekPredictor]
ORIGINAL_PREDICTORS = [cls() for cls in _PROVIDERS]
BLIND_PREDICTORS = [cls(blind=True) for cls in _PROVIDERS]
PREDICTORS = ORIGINAL_PREDICTORS + BLIND_PREDICTORS
INITIAL_BANKROLL = 20_000.0


def prediction_class(model_name: str):
    """The table a model/mode identity is stored in: blind identities live in the
    separate `blind_predictions` table, originals in `predictions`."""
    return BlindPrediction if is_blind(model_name) else Prediction


def get_bankroll(model_name: str, db: Session) -> float:
    Model = prediction_class(model_name)
    settled_pl = db.query(func.coalesce(func.sum(Model.profit_loss), 0)).filter(
        Model.model_name == model_name,
        Model.status.in_(["won", "lost"]),
    ).scalar()
    pending_stakes = db.query(func.coalesce(func.sum(Model.stake), 0)).filter(
        Model.model_name == model_name,
        Model.status == "pending",
    ).scalar()
    return INITIAL_BANKROLL + float(settled_pl) - float(pending_stakes)


def _existing_model_names(fixture_id: int, db: Session) -> set[str]:
    """Identities already stored for a fixture, across both tables."""
    names = {
        name for (name,) in db.query(Prediction.model_name)
        .filter(Prediction.fixture_id == fixture_id).all()
    }
    names |= {
        name for (name,) in db.query(BlindPrediction.model_name)
        .filter(BlindPrediction.fixture_id == fixture_id).all()
    }
    return names


def _predictors_for(model_names) -> list:
    """The predictor instances whose identities are in model_names, in order."""
    wanted = set(model_names)
    return [p for p in PREDICTORS if p.name in wanted]


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


def _data_lines(fixture_dict: dict, match_context: dict, external_id: str) -> list[str]:
    """The shared (odds-free) header of a prompt snapshot."""
    is_mock = not settings.apifootball_api_key or external_id.startswith("mock_")
    label = "MOCK" if is_mock else "REAL"
    return [
        f"USED DATA ({label}):",
        f"match: {fixture_dict['home_team']} vs {fixture_dict['away_team']}",
        f"league: {fixture_dict['league']}",
    ]


def _context_lines(match_context: dict) -> list[str]:
    lines = []
    for key, val in match_context.items():
        if val is None:
            lines.append(f"{key}: unavailable")
            continue
        if isinstance(val, dict):
            for subkey, subval in val.items():
                if subkey == "games":
                    continue
                lines.append(f"{key}_{subkey}: {subval}")
        else:
            lines.append(f"{key}: {val}")
    return lines


def _build_prompt_snapshot(fixture_dict: dict, match_context: dict, odds: dict, external_id: str) -> str:
    """Snapshot for original (odds-aware) predictions — includes the odds."""
    head = _data_lines(fixture_dict, match_context, external_id)
    head.append(f"odds_home: {odds['home']:.2f}")
    head.append(f"odds_draw: {odds['draw']:.2f}")
    head.append(f"odds_away: {odds['away']:.2f}")
    return "\n".join(head + _context_lines(match_context))


def _build_blind_prompt_snapshot(fixture_dict: dict, match_context: dict, external_id: str) -> str:
    """Snapshot for blind predictions — records exactly what the blind LLM saw.
    It must NOT contain bookmaker odds or any market guidance; the stored
    odds columns on the row are used by deterministic code, not the prompt."""
    head = _data_lines(fixture_dict, match_context, external_id)
    return "\n".join(head + _context_lines(match_context))


def _log_user_message(fixture_dict: dict, match_context: dict, odds: dict) -> None:
    """Log the exact user_message JSON the odds-aware models receive."""
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


def _log_blind_user_message(fixture_dict: dict, match_context: dict) -> None:
    """Log the blind user_message — deliberately without odds so the blind input
    can be audited without leaking the market into logs."""
    user_message = {
        "match": f"{fixture_dict['home_team']} vs {fixture_dict['away_team']}",
        "league": fixture_dict["league"],
        "context": match_context,
    }
    logger.info(
        "AI blind user_message for fixture %s:\n%s",
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
    """Run one AI model and save its result immediately when done. The blind
    odds columns are still stored — deterministic code uses them after the model
    response — but for blind predictions the prompt_snapshot carries no odds."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        result = await predictor.predict(fixture_dict, match_context, odds, bankroll)
        Model = prediction_class(result.model_name)
        prediction = Model(
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
        # Includes the unique (fixture_id, model_name) guard firing under a
        # concurrent trigger — the existing row stands, this one is dropped.
        pass
    finally:
        db.close()


def _snapshot_for(predictor, snapshot: str, blind_snapshot: str) -> str:
    return blind_snapshot if predictor.blind else snapshot


async def predict_all_in_background(
    fixture_id: int,
    fixture_dict: dict,
    external_id: str,
    odds_override: dict | None = None,
) -> None:
    """Fetch context + odds once, then run every missing model/mode in parallel.
    Idempotent: only the model/mode combinations not already stored are run, so
    repeated triggers and partial retries never duplicate predictions.

    TEMPORARY: when odds_override ({"home","draw","away"}) is given — or a manual
    override is registered for this fixture — those odds are used instead of the
    bookmaker feed (manual-odds testing). Remove the parameter, this branch, and
    the manual_odds lookup to restore."""
    from app.database import SessionLocal
    from app.services.manual_odds import get_manual_odds
    try:
        if odds_override is None:
            odds_override = get_manual_odds(external_id)
        if odds_override is not None:
            match_context, lineup_summary = await asyncio.gather(
                fetch_match_context(external_id),
                analyze_lineups(external_id),
            )
            odds = {**odds_override, "kickoff_at": None}
        else:
            match_context, odds, lineup_summary = await asyncio.gather(
                fetch_match_context(external_id),
                fetch_odds_with_live_fallback(
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
            missing = missing_models(_existing_model_names(fixture_id, db))
            predictors = _predictors_for(missing)
            bankrolls = {p.name: get_bankroll(p.name, db) for p in predictors}
        finally:
            db.close()

        if not predictors:
            return

        _log_user_message(fixture_dict, match_context, odds)
        _log_blind_user_message(fixture_dict, match_context)
        snapshot = _build_prompt_snapshot(fixture_dict, match_context, odds, external_id)
        blind_snapshot = _build_blind_prompt_snapshot(fixture_dict, match_context, external_id)

        await asyncio.gather(*[
            run_single_prediction(
                p, fixture_id, fixture_dict, match_context, odds,
                bankrolls[p.name], _snapshot_for(p, snapshot, blind_snapshot),
            )
            for p in predictors
        ])
    except Exception:
        pass


async def run_predictions(fixture: Fixture, db: Session) -> list[Prediction]:
    """Generate any missing model/mode predictions for a fixture and return all
    of its predictions (used by the /predictions/request endpoint). Idempotent:
    existing rows are kept, only missing combinations are generated."""
    fixture_dict = {
        "external_id": fixture.external_id,
        "home_team": fixture.home_team,
        "away_team": fixture.away_team,
        "home_team_id": fixture.home_team_id,
        "away_team_id": fixture.away_team_id,
        "league": fixture.league,
        "kickoff_at": fixture.kickoff_at,
    }

    def _all_for_fixture():
        return (
            db.query(Prediction).filter(Prediction.fixture_id == fixture.id).all()
            + db.query(BlindPrediction).filter(BlindPrediction.fixture_id == fixture.id).all()
        )

    missing = missing_models(_existing_model_names(fixture.id, db))
    predictors = _predictors_for(missing)
    if not predictors:
        return _all_for_fixture()

    match_context, odds, lineup_summary = await asyncio.gather(
        fetch_match_context(fixture.external_id),
        fetch_odds_with_live_fallback(
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
    _log_blind_user_message(fixture_dict, match_context)
    snapshot = _build_prompt_snapshot(fixture_dict, match_context, odds, fixture.external_id)
    blind_snapshot = _build_blind_prompt_snapshot(fixture_dict, match_context, fixture.external_id)
    bankrolls = {p.name: get_bankroll(p.name, db) for p in predictors}

    results = await asyncio.gather(
        *[p.predict(fixture_dict, match_context, odds, bankrolls[p.name]) for p in predictors]
    )
    snapshots = {p.name: _snapshot_for(p, snapshot, blind_snapshot) for p in predictors}

    predictions = [
        prediction_class(r.model_name)(
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
            prompt_snapshot=snapshots[r.model_name],
            home_value_score=r.home_value_score,
            draw_value_score=r.draw_value_score,
            away_value_score=r.away_value_score,
        )
        for r in results
    ]

    db.add_all(predictions)
    db.commit()
    return _all_for_fixture()
