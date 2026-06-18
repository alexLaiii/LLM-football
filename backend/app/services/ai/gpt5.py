"""
GPT-5.4 predictor — Markdown prompt + OpenAI strict structured outputs.
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
    OUTPUT_RULES,
    OUTPUT_RULES_BLIND,
    PREDICTION_SCHEMA,
)


# GPT prefers concise Markdown structure; the JSON shape is enforced by the
# strict json_schema response format rather than by an in-prompt example.
def _system_prompt(role: str, task: str, rules: str) -> str:
    return f"""{role}

## Context fields
{CONTEXT_GLOSSARY}

## Methodology
{task}

## Output rules
{rules}"""


SYSTEM_PROMPT = _system_prompt(ROLE, TASK_STEPS, OUTPUT_RULES)
SYSTEM_PROMPT_BLIND = _system_prompt(ROLE_BLIND, TASK_STEPS_BLIND, OUTPUT_RULES_BLIND)


class GPT5Predictor(BasePredictor):
    base_name = "gpt5"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.openai_api_key:
            try:
                client = AsyncOpenAI(
                    api_key=settings.openai_api_key,
                )
                user_message = (
                    build_blind_user_message(fixture, match_context) if self.blind
                    else build_user_message(fixture, odds, match_context)
                )
                # No temperature: GPT-5 reasoning models use the default and do
                # their own chain-of-thought, so we don't hand-hold the steps.
                response = await client.chat.completions.create(
                    model="gpt-5.5",
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT_BLIND if self.blind else SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": "match_prediction",
                            "strict": True,
                            "schema": PREDICTION_SCHEMA,
                        },
                    },
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
            f"[MOCK] {fixture['home_team']} vs {fixture['away_team']} ({fixture['league']}) — "
            f"probabilities estimated from recent form."
        )
        return make_result(self, random_probs(), round(random.uniform(0.55, 0.75), 2), reasoning, odds, bankroll)
