"""
Claude predictor — prompt formatted in Anthropic's recommended XML style.
"""
import random

import anthropic

from app.services.ai.base import (
    BasePredictor,
    PredictionResult,
    build_match_data,
    world_cup_rules,
    extract_json,
    make_result,
    random_probs,
    ROLE,
    CONTEXT_GLOSSARY,
    TASK_STEPS,
    JSON_EXAMPLE,
    OUTPUT_RULES,
)

# Claude responds best to clearly delimited XML sections.
SYSTEM_PROMPT = f"""<role>
{ROLE}
</role>

<context_fields>
{CONTEXT_GLOSSARY}
</context_fields>

<task>
{TASK_STEPS}
</task>

<output_format>
Respond with a single JSON object, and nothing else, in exactly this shape:
{JSON_EXAMPLE}
</output_format>

<rules>
{OUTPUT_RULES}
</rules>"""


class ClaudePredictor(BasePredictor):
    name = "claude"

    async def predict(self, fixture, match_context, odds, current_bankroll) -> PredictionResult:
        from app.config import settings
        if settings.anthropic_api_key:
            try:
                client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
                content = f"<match_data>\n{build_match_data(fixture, odds, match_context)}\n</match_data>"
                # Keep World Cup guidance in its own tag rather than mixed into
                # the match data, preserving the clean instruction/data split.
                wc_rules = world_cup_rules(fixture).strip()
                if wc_rules:
                    content += f"\n\n<world_cup_rules>\n{wc_rules}\n</world_cup_rules>"
                response = await client.messages.create(
                    model="claude-opus-4-8",
                    max_tokens=1024,
                    # Cache the (large, static) system prompt across calls.
                    system=[{
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }],
                    messages=[{"role": "user", "content": content}],
                )
                # opus-4-8 doesn't support assistant prefill, so we rely on the
                # prompt (which demands a single JSON object) plus extract_json,
                # which tolerates any thinking/wrapper text around the object.
                text = "".join(b.text for b in response.content if getattr(b, "type", None) == "text")
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
