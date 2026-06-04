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


def build_user_message(fixture: dict, odds: dict, match_context: dict) -> str:
    """Shared user message for all predictors. Appends WC-specific rules for World Cup fixtures only."""
    msg = (
        f"Match: {fixture['home_team']} vs {fixture['away_team']}\n"
        f"League: {fixture['league']}\n"
        f"Odds: Home={odds['home']:.2f}, Draw={odds['draw']:.2f}, Away={odds['away']:.2f}\n"
        f"Context: {json.dumps(match_context)}"
    )
    if fixture.get("league") == "World Cup":
        msg += f"\n{_WC_RULES}"
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
    name: str
    initial_bankroll: float = 20_000.0

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
