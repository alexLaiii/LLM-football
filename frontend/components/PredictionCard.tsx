"use client";

import { useState, type CSSProperties } from "react";
import type { Prediction } from "@/lib/api";
import ModelIcon from "@/components/ModelIcon";
import { baseModel, modelLabel } from "@/lib/models";

const MODEL_ACCENTS: Record<string, string> = {
  claude: "#4169a1",
  gpt5: "#2f8b57",
  gemini: "#7a4ba0",
  grok: "#b73d38",
  deepseek: "#7bb7d8",
};

const pickLabel: Record<string, string> = { home: "HOME", draw: "DRAW", away: "AWAY" };
type Outcome = "home" | "draw" | "away";

function money(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function statusBadge(prediction: Prediction) {
  if (prediction.status === "won") return { label: `WON ${money(prediction.profit_loss ?? 0)}`, cls: "border-[rgba(56,209,124,.45)] bg-[rgba(56,209,124,.08)] text-[var(--term-pos)]" };
  if (prediction.status === "lost") return { label: `LOST ${money(prediction.profit_loss ?? 0)}`, cls: "border-[rgba(255,89,112,.45)] bg-[rgba(255,89,112,.08)] text-[var(--term-neg)]" };
  if (prediction.status === "void") return { label: "VOID", cls: "border-[var(--term-border-2)] text-[var(--term-dim)]" };
  return { label: "PENDING", cls: "border-[rgba(255,180,84,.38)] text-[var(--term-amber)]" };
}

function isMockPrediction(prediction: Prediction) {
  return prediction.reasoning.trim().startsWith("[MOCK]") || prediction.prompt_snapshot?.startsWith("USED DATA (MOCK):");
}

function ProbRow({
  label,
  pct,
  value,
  color,
  shimmer,
}: {
  label: string;
  pct: number;
  value: number | null;
  color: string;
  shimmer?: boolean;
}) {
  const whole = Math.round(pct * 100);
  return (
    <div className="grid grid-cols-[44px_1fr_42px_44px] items-center gap-2.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">{label}</span>
      <span className="relative h-[6px] overflow-hidden border border-[var(--term-border)] bg-[var(--term-surface-2)]">
        <i
          className={`absolute inset-y-0 left-0 block transition-[width] duration-700 ${shimmer ? "after:absolute after:inset-0 after:translate-x-[-100%] after:bg-gradient-to-r after:from-transparent after:via-white/30 after:to-transparent after:content-[''] after:animate-[terminal-progress_2.6s_ease-in-out_infinite]" : ""}`}
          style={{ width: `${whole}%`, background: color }}
          aria-hidden="true"
        />
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-[var(--term-text)]">{whole}%</span>
      <span className={`text-right font-mono text-[11px] tabular-nums ${value !== null && value >= 1 ? "text-[var(--term-pos)]" : "text-[var(--term-dim)]"}`}>
        {value === null ? "--" : `${value.toFixed(2)}x`}
      </span>
    </div>
  );
}

function Cell({ label, value, color, border }: { label: string; value: string; color?: string; border?: boolean }) {
  return (
    <div className={`p-[11px_14px] ${border ? "border-l border-[var(--term-border)]" : ""}`}>
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums" style={{ color: color ?? "var(--term-text)" }}>{value}</div>
    </div>
  );
}

function promptOdds(prediction: Prediction): Partial<Record<Outcome, number>> {
  const odds: Partial<Record<Outcome, number>> = {};
  for (const match of prediction.prompt_snapshot?.matchAll(/^odds_(home|draw|away):\s*([0-9]+(?:\.[0-9]+)?)/gm) ?? []) {
    odds[match[1] as Outcome] = Number(match[2]);
  }
  return odds;
}

function outcomeOdds(prediction: Prediction, side: Outcome) {
  const saved = side === "home" ? prediction.odds_home : side === "draw" ? prediction.odds_draw : prediction.odds_away;
  if (saved !== null && saved !== undefined) return saved;
  const snapshot = promptOdds(prediction)[side];
  if (snapshot !== undefined) return snapshot;
  return prediction.bet_on === side ? prediction.odds : null;
}

function valueScore(prediction: Prediction, side: Outcome) {
  const odds = outcomeOdds(prediction, side);
  if (odds === null) return prediction[`${side}_value_score`];
  return prediction[`${side}_prob`] * odds;
}

export default function PredictionCard({ prediction }: { prediction: Prediction }) {
  const [expanded, setExpanded] = useState(false);
  const label = modelLabel(prediction.model_name);
  const accent = MODEL_ACCENTS[baseModel(prediction.model_name)] ?? "var(--term-cyan)";
  const badge = statusBadge(prediction);
  const mock = isMockPrediction(prediction);
  const pick = pickLabel[prediction.bet_on] ?? prediction.bet_on.toUpperCase();
  const homeValue = valueScore(prediction, "home");
  const drawValue = valueScore(prediction, "draw");
  const awayValue = valueScore(prediction, "away");

  return (
    <article
      className="flex flex-col border border-[var(--term-border)] bg-[var(--term-surface)]"
      style={{ "--model-accent": accent, boxShadow: `0 0 22px -16px ${accent}` } as CSSProperties}
    >
      <div className="border-b border-t-2 border-b-[var(--term-border)] p-[14px_16px]" style={{ borderTopColor: accent }}>
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-[26px] w-[26px] place-items-center overflow-hidden border bg-[var(--term-surface-2)] p-1"
            style={{ borderColor: accent, color: accent, background: `color-mix(in oklab, ${accent} 18%, var(--term-surface-2))` }}
          >
            <ModelIcon model={prediction.model_name} label={label} className="h-full w-full object-contain" />
          </span>
          <span className="font-mono text-sm font-semibold text-[var(--term-text)]">{label}</span>
          {mock && (
            <span className="border border-[rgba(255,89,112,.48)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--term-neg)]">
              MOCK
            </span>
          )}
          <span className={`ml-auto inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${badge.cls}`}>
            {prediction.status === "pending" && <i className="h-[6px] w-[6px] rounded-full bg-[var(--term-cyan)]" />}
            {badge.label}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">BETTING</span>
          <span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${prediction.bet_on === "draw" ? "border-[rgba(255,180,84,.42)] text-[var(--term-amber)]" : "border-[rgba(56,209,124,.42)] text-[var(--term-pos)]"}`}>
            {pick}
          </span>
          <span className="font-mono text-xs tabular-nums text-[var(--term-text)]">@ {prediction.odds.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid gap-2 p-[14px_16px]">
        <ProbRow label="HOME" pct={prediction.home_prob} value={homeValue} color="var(--term-pos)" shimmer />
        <ProbRow label="DRAW" pct={prediction.draw_prob} value={drawValue} color="var(--term-amber)" />
        <ProbRow label="AWAY" pct={prediction.away_prob} value={awayValue} color="var(--term-neg)" />
      </div>

      <div className="grid grid-cols-3 border-t border-[var(--term-border)]">
        <Cell label="CONF" value={`${Math.round(prediction.confidence * 100)}%`} />
        <Cell label="EV" value={`${prediction.expected_value >= 0 ? "+" : ""}${prediction.expected_value.toFixed(3)}`} color={prediction.expected_value >= 0 ? "var(--term-pos)" : "var(--term-neg)"} border />
        <Cell label="STAKE" value={`$${prediction.stake.toFixed(2)}`} border />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="border-t border-[var(--term-border)] bg-transparent p-[10px_16px] text-left font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-muted)] transition-colors hover:text-[var(--accent)]"
      >
        <span className="text-[var(--term-dim)]">{expanded ? "v" : ">"}</span> {expanded ? "HIDE" : "SHOW"} REASONING
      </button>

      {expanded && (
        <div className="p-[0_16px_16px]">
          <p className="mt-2 border-l-2 border-[var(--term-border-2)] pl-3 text-[12.5px] leading-relaxed text-[var(--term-muted)]">
            {prediction.reasoning}
          </p>
        </div>
      )}
    </article>
  );
}
