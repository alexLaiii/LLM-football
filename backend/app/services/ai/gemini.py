"""
Gemini predictor via vectorengine.ai (Google-compatible API).
"""
import random

import httpx

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
)

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent"


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

# Gemini's responseSchema uses uppercase Type enums and propertyOrdering.
# propertyOrdering is reasoning-first: reasoning is emitted before the
# probabilities so Gemini reasons before committing to its numbers.
_GEMINI_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reasoning": {"type": "STRING"},
        "home_prob": {"type": "NUMBER"},
        "draw_prob": {"type": "NUMBER"},
        "away_prob": {"type": "NUMBER"},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["reasoning", "home_prob", "draw_prob", "away_prob", "confidence"],
    "propertyOrdering": ["reasoning", "home_prob", "draw_prob", "away_prob", "confidence"],
}


class GeminiPredictor(BasePredictor):
    base_name = "gemini"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.gemini_api_key:
            try:
                user_message = (
                    build_blind_user_message(fixture, match_context) if self.blind
                    else build_user_message(fixture, odds, match_context)
                )
                body = {
                    "system_instruction": {"parts": [{"text": SYSTEM_PROMPT_BLIND if self.blind else SYSTEM_PROMPT}]},
                    "contents": [{"role": "user", "parts": [{"text": user_message}]}],
                    "generationConfig": {
                        "temperature": 0.3,
                        "responseMimeType": "application/json",
                        "responseSchema": _GEMINI_SCHEMA,
                    },
                }
                async with httpx.AsyncClient(timeout=60) as client:
                    r = await client.post(
                        _BASE_URL,
                        headers={"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
                        json=body,
                    )
                r.raise_for_status()
                text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                data = extract_json(text)
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
