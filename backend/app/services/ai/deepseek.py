"""
DeepSeek predictor (OpenAI-compatible API).
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


# DeepSeek-R1 is a reasoning model. DeepSeek's guidance: do NOT use a system
# prompt (put everything in the user turn), do NOT force step-by-step, avoid
# JSON mode, and use a temperature around 0.6. So we hand it one self-contained
# user message and parse the JSON out of its answer.
def _instructions(role: str, task: str, rules: str) -> str:
    return f"""{role}

{CONTEXT_GLOSSARY}

{task}

Respond with a single JSON object, and nothing else, in exactly this shape:
{JSON_EXAMPLE}

{rules}"""


_INSTRUCTIONS = _instructions(ROLE, TASK_STEPS, OUTPUT_RULES)
_INSTRUCTIONS_BLIND = _instructions(ROLE_BLIND, TASK_STEPS_BLIND, OUTPUT_RULES_BLIND)


class DeepSeekPredictor(BasePredictor):
    base_name = "deepseek"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.deepseek_api_key:
            try:
                client = AsyncOpenAI(
                    api_key=settings.deepseek_api_key,
                    base_url="https://api.vectorengine.ai/v1",
                )
                instructions = _INSTRUCTIONS_BLIND if self.blind else _INSTRUCTIONS
                user_message = (
                    build_blind_user_message(fixture, match_context) if self.blind
                    else build_user_message(fixture, odds, match_context)
                )
                response = await client.chat.completions.create(
                    model="deepseek-r1",
                    messages=[
                        {"role": "user", "content": f"{instructions}\n\n---\n{user_message}"},
                    ],
                    temperature=0.6,
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
            f"probabilities estimated from recent form and H2H."
        )
        return make_result(self, random_probs(), round(random.uniform(0.60, 0.80), 2), reasoning, odds, bankroll)
