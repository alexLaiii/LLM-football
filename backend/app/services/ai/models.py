"""Central registry of AI model/mode identities.

Two prediction modes share the same five providers:
- "original": bookmaker-aware (sees the odds as a market reference).
- "blind":    the LLM never sees odds; deterministic code applies them afterward.

Every other module (orchestrator, settlement, bankrolls, leaderboard, history,
compare, schemas) should import these constants rather than hard-coding the
five-model list, so blind identities are handled consistently.
"""

BLIND_SUFFIX = "_blind"

# The five original bookmaker-aware model identities. Order is the display order.
ORIGINAL_MODELS: list[str] = ["claude", "gpt5", "gemini", "grok", "deepseek"]

# The five blind counterparts. claude -> claude_blind, etc.
BLIND_MODELS: list[str] = [f"{m}{BLIND_SUFFIX}" for m in ORIGINAL_MODELS]

# All ten prediction identities for a freshly predicted fixture.
ALL_MODELS: list[str] = ORIGINAL_MODELS + BLIND_MODELS

# A newly triggered fixture should ultimately have this many prediction records.
EXPECTED_PREDICTIONS_PER_FIXTURE: int = len(ALL_MODELS)

_BASE_LABELS = {
    "claude": "Claude",
    "gpt5": "ChatGPT",
    "gemini": "Gemini",
    "grok": "Grok",
    "deepseek": "DeepSeek",
}

# Display names for every identity, e.g. "Claude" and "Claude (blind)".
MODEL_LABELS: dict[str, str] = {
    **_BASE_LABELS,
    **{f"{m}{BLIND_SUFFIX}": f"{label} (blind)" for m, label in _BASE_LABELS.items()},
}


def is_blind(model_name: str) -> bool:
    return model_name.endswith(BLIND_SUFFIX)


def base_model(model_name: str) -> str:
    """Strip the blind suffix, e.g. 'claude_blind' -> 'claude'."""
    return model_name[: -len(BLIND_SUFFIX)] if is_blind(model_name) else model_name


def label_for(model_name: str) -> str:
    return MODEL_LABELS.get(model_name, model_name)


def missing_models(existing_model_names) -> list[str]:
    """Given the model_names already stored for a fixture, return the
    model/mode combinations still to generate, in canonical order.

    Empty input -> all ten. A fixture with only the original five -> the five
    blind ones. A complete fixture -> []. Never returns a name already present,
    so triggering is idempotent and partial retries only fill the gaps."""
    existing = set(existing_model_names)
    return [m for m in ALL_MODELS if m not in existing]
