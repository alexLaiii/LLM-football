import { baseModel } from "@/lib/models";

const MODEL_ICON_SRC: Record<string, string> = {
  claude: "/animations/claude-ai-icon.png",
  gpt5: "/animations/chatgpt-icon.png",
  gemini: "/animations/Google_Gemini_icon_2025.svg.png",
  grok: "/animations/grok-icon.png",
  deepseek: "/animations/Deepseek.png",
};

type Props = {
  model: string;
  label?: string;
  className?: string;
};

export function modelIconSrc(model: string) {
  // Blind identities (e.g. "claude_blind") reuse the base model's icon.
  return MODEL_ICON_SRC[baseModel(model)] ?? null;
}

export default function ModelIcon({ model, label, className = "h-full w-full" }: Props) {
  const src = modelIconSrc(model);
  if (!src) return null;
  return <img src={src} alt={label ? `${label} icon` : ""} className={className} />;
}
