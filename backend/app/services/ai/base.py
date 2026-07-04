import json
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass

# This page generalize the user_message creation and differentiate between world cup matches and non world cup matches.
_WC_RULES = """
World Cup 2026-specific rules:
- Treat international-team form carefully. Competitive qualifiers and major tournament matches should carry more weight than friendlies.
- For group-stage matches, consider group incentives: whether each team needs a win, would accept a draw, needs goal difference, or may rotate players.
- For Matchday 3 group games, heavily consider qualification scenarios and rotation risk.
- For knockout matches, remember that home/draw/away refers to the result after 90 minutes unless the input explicitly says otherwise.
- Do not treat club-style home advantage normally. Only apply home advantage when the team is a host nation or has a clear crowd/location advantage.
- Consider travel and rest differences more strongly than in normal domestic league matches.
- Be careful with H2H between national teams; old H2H data may be much less relevant because squads and managers change.
- If lineup data is unavailable, reduce confidence, especially in knockout matches or Matchday 3 group-stage matches where rotation is likely.
- Prioritize long-term national-team strength over raw last-5 form, especially when recent matches include friendlies or weak opposition. If provided in the context, use Elo rating (higher = stronger) and FIFA world ranking (lower number = stronger, rank 1 is the best team); otherwise rely on overall squad quality and pedigree.

When estimating true probabilities, weight factors approximately as:
- Long-term national-team strength (Elo, FIFA ranking, squad quality): 30-40%
- Current squad, lineup, injuries, suspensions: 20-30%
- Tournament situation, motivation, rotation risk: 15-25%
- Recent form and goal trends: 10-15%
- Venue, travel, rest, and host advantage: 5-10%
- H2H: 0-5%"""


# ---------------------------------------------------------------------------
# Shared prompt building blocks.
#
# The *content* below is identical for every model — only each model file's
# *formatting* of it differs (XML for Claude, Markdown for GPT/Grok/Gemini,
# a single user turn for the DeepSeek-R1 reasoning model). Keeping the task
# text shared means the leaderboard compares models, not divergent prompts.
# ---------------------------------------------------------------------------
ROLE = (
    "You are a football match prediction analyst. Using the match information and the "
    "bookmaker odds as a market reference, estimate the TRUE probability of each outcome "
    "(home win, draw, away win) for the full-time result after 90 minutes plus stoppage "
    "time only — extra time and penalty shootouts do NOT count — as accurately and "
    "honestly as you can. A separate system turns your probabilities into the bet, so your "
    "only job is a well-calibrated probability estimate — do not pick a bet or compute "
    "value/expected value yourself."
)

CONTEXT_GLOSSARY = """The context JSON may contain:
- home_last5 / away_last5: recent form over last 5 matches
- home_last5_home / away_last5_away: home/away-specific form splits
- home_goals_avg_last5 / away_goals_avg_last5: average goals scored in last 5 matches
- home_goals_avg_last5_home / away_goals_avg_last5_away: average goals scored in home/away split
- home_standing / away_standing: league position, points, wins, draws, losses, goals for, goals against, goal difference
- home_rest_days / away_rest_days: days since each team's last match
- home_top_scorer / away_top_scorer: team's top scorer and goals
- h2h: head-to-head record between the teams
- home_lineup / away_lineup: starting XI if available
- home_injuries / away_injuries: injured/suspended players
- lineup_summary: natural-language summary of lineup strength and key absences for both teams
- neutral_venue: true if neither team has home-crowd advantage at this venue
- host_nation: (World Cup) the team playing in its own country, i.e. with host/home-crowd advantage; absent when neutral"""

TASK_STEPS = """1. Judge the relative strength of the two teams from the match context (form, standings, lineups, injuries, rest days, H2H, home/away splits).
2. Treat the bookmaker odds as the market's view, for reference only — form your own honest estimate rather than copying the market back.
3. Output your true probability for each outcome as home_prob, draw_prob, away_prob. They must sum to 1.00.
4. Give a short reasoning for the key factors behind your estimate, plus an overall confidence in it.

Do NOT choose a bet, and do NOT compute value scores or expected value — that is handled deterministically in code from your probabilities. Focus only on producing a well-calibrated probability estimate."""

# ---------------------------------------------------------------------------
# Blind prompt building blocks.
#
# Identical task to the originals EXCEPT the model never sees, and is never told
# about, the bookmaker odds. The blind text deliberately mentions no odds,
# market, price, implied probability, value, or expected value. After the model
# returns its probabilities, the same deterministic code path (make_result)
# applies the real odds to pick the bet, size the stake, and settle later.
# ---------------------------------------------------------------------------
ROLE_BLIND = (
    "You are a football match prediction analyst. Using only the match information "
    "provided, independently estimate the TRUE probability of each outcome (home win, "
    "draw, away win) for the full-time result after 90 minutes plus stoppage time only — "
    "extra time and penalty shootouts do NOT count — as accurately and honestly as you "
    "can. A separate system turns your probabilities into a decision, so your only job is "
    "a well-calibrated probability estimate."
)

TASK_STEPS_BLIND = """1. Judge the relative strength of the two teams from the match context (form, standings, lineups, injuries, rest days, H2H, home/away splits).
2. Independently estimate the true probability of each outcome from the match context alone.
3. Output your true probability for each outcome as home_prob, draw_prob, away_prob. They must sum to 1.00.
4. Give a short reasoning for the key factors behind your estimate, plus an overall confidence in it.

Focus only on producing a well-calibrated probability estimate from the match context."""

OUTPUT_RULES_BLIND = """- home_prob + draw_prob + away_prob must sum to 1.00 after rounding to 2 decimal places.
- Each probability must be a decimal between 0 and 1.
- confidence must be between 0.35 and 0.95.
- reasoning must be 1-2 sentences on the key factors behind the probabilities.
- Do not include markdown, extra keys, calculations, or any text outside the JSON."""

JSON_EXAMPLE = """{
  "reasoning": "Brief explanation of the key factors behind these probabilities.",
  "home_prob": 0.45,
  "draw_prob": 0.27,
  "away_prob": 0.28,
  "confidence": 0.65
}"""

OUTPUT_RULES = """- home_prob + draw_prob + away_prob must sum to 1.00 after rounding to 2 decimal places.
- Each probability must be a decimal between 0 and 1.
- confidence must be between 0.35 and 0.95.
- reasoning must be 1-2 sentences on the key factors behind the probabilities, not a bet recommendation.
- Do not include markdown, a bet pick, value scores, extra keys, calculations, or any text outside the JSON."""

# JSON schema for providers with structured outputs (OpenAI, Gemini). The model
# returns ONLY its probability estimate, reasoning, and confidence; the bet,
# value scores, and EV are computed in code (see make_result).
# Fields are ordered reasoning-first so the model reasons before committing to
# the probabilities (structured outputs emit fields in property order).
_SCHEMA_FIELDS = ["reasoning", "home_prob", "draw_prob", "away_prob", "confidence"]

PREDICTION_SCHEMA = {
    "type": "object",
    "properties": {
        "reasoning": {"type": "string"},
        "home_prob": {"type": "number"},
        "draw_prob": {"type": "number"},
        "away_prob": {"type": "number"},
        "confidence": {"type": "number"},
    },
    "required": _SCHEMA_FIELDS,
    "additionalProperties": False,
}


def extract_json(raw: str) -> dict:
    """Parse a JSON object out of a model response, tolerating code fences and
    any leading/trailing prose (e.g. a reasoning model's stray text)."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.lstrip().lower().startswith("json"):
            raw = raw.lstrip()[4:]
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1:
        raw = raw[start:end + 1]
    return json.loads(raw)


def build_match_data(fixture: dict, odds: dict, match_context: dict) -> str:
    """The match data block (no competition rules), shared by all predictors."""
    return (
        f"Match: {fixture['home_team']} vs {fixture['away_team']}\n"
        f"League: {fixture['league']}\n"
        f"Odds: Home={odds['home']:.2f}, Draw={odds['draw']:.2f}, Away={odds['away']:.2f}\n"
        f"Context: {json.dumps(match_context)}"
    )


def world_cup_rules(fixture: dict) -> str:
    """World Cup-specific guidance, or '' for other competitions."""
    return _WC_RULES if fixture.get("league") == "World Cup" else ""


def build_user_message(fixture: dict, odds: dict, match_context: dict) -> str:
    """Shared user message for all predictors. Appends WC-specific rules for World Cup fixtures only."""
    msg = build_match_data(fixture, odds, match_context)
    rules = world_cup_rules(fixture)
    if rules:
        msg += f"\n{rules}"
    return msg


def build_blind_match_data(fixture: dict, match_context: dict) -> str:
    """The match data block for blind predictions — identical to the original's
    non-odds content, with the Odds line removed. Used by all blind predictors."""
    return (
        f"Match: {fixture['home_team']} vs {fixture['away_team']}\n"
        f"League: {fixture['league']}\n"
        f"Context: {json.dumps(match_context)}"
    )


def build_blind_user_message(fixture: dict, match_context: dict) -> str:
    """Shared blind user message. Same context (and WC rules) as the original
    user message, but never contains the bookmaker odds."""
    msg = build_blind_match_data(fixture, match_context)
    rules = world_cup_rules(fixture)
    if rules:
        msg += f"\n{rules}"
    return msg


@dataclass
class PredictionResult:
    model_name: str
    home_prob: float
    draw_prob: float
    away_prob: float
    bet_on: str        # "home" | "draw" | "away"
    confidence: float  # 0.0 – 1.0
    expected_value: float
    stake: float
    odds: float
    reasoning: str
    home_value_score: float | None = None
    draw_value_score: float | None = None
    away_value_score: float | None = None


class BasePredictor(ABC):
    base_name: str           # provider identity, e.g. "claude"
    initial_bankroll: float = 20_000.0

    def __init__(self, blind: bool = False):
        # One predictor class serves both modes; the only differences are the
        # identity it records and which (odds-aware vs blind) prompt it sends.
        self.blind = blind
        self.name = f"{self.base_name}_blind" if blind else self.base_name

    @abstractmethod
    async def predict(
        self,
        fixture: dict,
        match_context: dict,
        odds: dict,
        current_bankroll: float,
    ) -> PredictionResult: ...

    def calculate_stake(self, ev: float, confidence: float, bankroll: float, odds: float) -> float:
        """Quarter-Kelly stake, floored at 0.1% and capped at 2.5% of bankroll."""
        if ev <= 0:
            return round(bankroll * 0.001, 2)
        kelly_fraction = ev / (odds - 1)
        stake = bankroll * kelly_fraction * 0.25
        stake = max(stake, bankroll * 0.001)
        stake = min(stake, bankroll * 0.025)
        return round(min(stake, bankroll), 2)


def random_probs() -> dict[str, float]:
    """Random home/draw/away probabilities that sum to 1."""
    a, b = sorted([random.random(), random.random()])
    return {"home": round(a, 3), "draw": round(b - a, 3), "away": round(1 - b, 3)}


def compute_value(probs: dict, odds: dict) -> tuple[dict, dict]:
    """From true probabilities + decimal odds, return (value_scores, expected_values)
    per outcome. value = prob / raw implied probability; ev = prob * odds - 1.
    Done in code so the numbers are always internally consistent."""
    value = {k: round(probs[k] * odds[k], 2) for k in ("home", "draw", "away")}
    ev = {k: probs[k] * odds[k] - 1 for k in ("home", "draw", "away")}
    return value, ev


def make_result(predictor: "BasePredictor", raw_probs: dict, confidence: float,
                reasoning: str, odds: dict, bankroll: float) -> PredictionResult:
    """Build a full prediction from a model's probability estimate. The bet,
    value scores, EV, and stake are all computed here, so they always reconcile —
    the model only supplies probabilities, reasoning, and confidence."""
    total = raw_probs["home"] + raw_probs["draw"] + raw_probs["away"]
    if total <= 0:
        total = 1.0
    probs = {k: raw_probs[k] / total for k in ("home", "draw", "away")}
    value, ev_all = compute_value(probs, odds)
    bet_on = max(ev_all, key=ev_all.get)  # highest EV (equivalently, highest value score)
    bet_odds = odds[bet_on]
    ev = round(ev_all[bet_on], 3)
    stake = predictor.calculate_stake(ev, confidence, bankroll, bet_odds)
    return PredictionResult(
        model_name=predictor.name,
        home_prob=round(probs["home"], 3),
        draw_prob=round(probs["draw"], 3),
        away_prob=round(probs["away"], 3),
        bet_on=bet_on,
        confidence=confidence,
        expected_value=ev,
        stake=stake,
        odds=bet_odds,
        reasoning=reasoning,
        home_value_score=value["home"],
        draw_value_score=value["draw"],
        away_value_score=value["away"],
    )
