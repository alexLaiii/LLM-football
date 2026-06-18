"""
Grok predictor (OpenAI-compatible API via vectorengine.ai).
"""
import random

from openai import AsyncOpenAI

from app.services.ai.base import (
    BasePredictor,
    PredictionResult,
    build_user_message,
    build_blind_user_message,
    extract_json,
    make_result,
    random_probs,
    ROLE,
    ROLE_BLIND,
    CONTEXT_GLOSSARY,
    TASK_STEPS,
    TASK_STEPS_BLIND,
    JSON_EXAMPLE,
    OUTPUT_RULES,
    OUTPUT_RULES_BLIND,
)


def _system_prompt(role: str, task: str, rules: str) -> str:
    return f"""{role}

## Context fields
{CONTEXT_GLOSSARY}

## Methodology
{task}

## Output format
Respond with a single JSON object, and nothing else, in exactly this shape:
{JSON_EXAMPLE}

## Output rules
{rules}"""


SYSTEM_PROMPT = _system_prompt(ROLE, TASK_STEPS, OUTPUT_RULES)
SYSTEM_PROMPT_BLIND = _system_prompt(ROLE_BLIND, TASK_STEPS_BLIND, OUTPUT_RULES_BLIND)


class GrokPredictor(BasePredictor):
    base_name = "grok"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.grok_api_key:
            try:
                client = AsyncOpenAI(
                    api_key=settings.grok_api_key,
                    base_url="https://api.x.ai/v1",
                )
                user_message = (
                    build_blind_user_message(fixture, match_context) if self.blind
                    else build_user_message(fixture, odds, match_context)
                )
                response = await client.chat.completions.create(
                    model="grok-4.3",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT_BLIND if self.blind else SYSTEM_PROMPT},
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
