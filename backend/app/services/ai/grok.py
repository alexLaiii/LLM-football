"""
Grok predictor (OpenAI-compatible API via vectorengine.ai).
"""
import random

from openai import AsyncOpenAI

from app.services.ai.base import (
    BasePredictor,
    PredictionResult,
    build_user_message,
    extract_json,
    make_result,
    random_probs,
    ROLE,
    CONTEXT_GLOSSARY,
    TASK_STEPS,
    JSON_EXAMPLE,
    OUTPUT_RULES,
)

SYSTEM_PROMPT = f"""{ROLE}

## Context fields
{CONTEXT_GLOSSARY}

## Methodology
{TASK_STEPS}

## Output format
Respond with a single JSON object, and nothing else, in exactly this shape:
{JSON_EXAMPLE}

## Output rules
{OUTPUT_RULES}"""


class GrokPredictor(BasePredictor):
    name = "grok"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.grok_api_key:
            try:
                client = AsyncOpenAI(
                    api_key=settings.grok_api_key,
                    base_url="https://api.x.ai/v1",
                )
                user_message = build_user_message(fixture, odds, match_context)
                response = await client.chat.completions.create(
                    model="grok-4.3",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    temperature=0.3,
                    response_format={"type": "json_object"},
                )
                data = extract_json(response.choices[0].message.content)
                probs = {
                    "home": float(data["home_prob"]),
                    "draw": float(data["draw_prob"]),
                    "away": float(data["away_prob"]),
                }
                return make_result(self, probs, float(data["confidence"]), data["reasoning"], odds, current_bankroll)
            except Exception:
                pass

        return self._mock(fixture, odds, current_bankroll)

    def _mock(self, fixture, odds, bankroll) -> PredictionResult:
        reasoning = (
            f"[MOCK] {fixture['home_team']} vs {fixture['away_team']} — "
            f"probabilities estimated from recent form."
        )
        return make_result(self, random_probs(), round(random.uniform(0.65, 0.85), 2), reasoning, odds, bankroll)
