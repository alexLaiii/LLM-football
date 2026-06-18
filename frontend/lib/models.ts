// Shared AI model/mode identity helpers, mirroring backend/app/services/ai/models.py.
// "Blind" identities are suffixed "_blind" (e.g. "claude_blind") and reuse the
// base model's icon/colour with a "(blind)" label.

export const BLIND_SUFFIX = "_blind";
export const ORIGINAL_MODELS = ["claude", "gpt5", "gemini", "grok", "deepseek"] as const;
export const BLIND_MODELS = ORIGINAL_MODELS.map((m) => `${m}${BLIND_SUFFIX}`);

// Predictions per mode (the five cards shown for one toggle state), and the
// total stored per freshly predicted fixture (original five + blind five).
export const TOTAL_AI_PREDICTIONS_PER_MODE = ORIGINAL_MODELS.length;
export const EXPECTED_PREDICTIONS_PER_FIXTURE = ORIGINAL_MODELS.length + BLIND_MODELS.length;

const BASE_LABELS: Record<string, string> = {
  claude: "Claude",
  gpt5: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  deepseek: "DeepSeek",
};

export const isBlindModel = (name: string) => name.endsWith(BLIND_SUFFIX);

export const baseModel = (name: string) =>
  isBlindModel(name) ? name.slice(0, -BLIND_SUFFIX.length) : name;

export function modelLabel(name: string) {
  const label = BASE_LABELS[baseModel(name)] ?? baseModel(name);
  return isBlindModel(name) ? `${label} (blind)` : label;
}
