"use client";

import { useState } from "react";
import type { Prediction } from "@/lib/api";

function snapshotOf(predictions: Prediction[]) {
  return predictions.find((p) => p.prompt_snapshot)?.prompt_snapshot ?? null;
}

export default function MatchContextDebug({
  predictions,
  blindPredictions = [],
}: {
  predictions: Prediction[];
  blindPredictions?: Prediction[];
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"original" | "blind">("original");

  const originalSnapshot = snapshotOf(predictions);
  const blindSnapshot = snapshotOf(blindPredictions);
  const hasBoth = !!originalSnapshot && !!blindSnapshot;

  // Show whatever exists if the selected view's snapshot isn't ready yet.
  const activeView =
    view === "blind" && !blindSnapshot ? "original" :
    view === "original" && !originalSnapshot ? "blind" :
    view;
  const snapshot = activeView === "blind" ? blindSnapshot : originalSnapshot;
  if (!snapshot) return null;

  const isMock = snapshot.includes("(MOCK)");
  const isBlind = activeView === "blind";

  return (
    <div className="mt-6 border border-[var(--term-border)] bg-[var(--term-surface)] p-3.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-muted)] transition-colors hover:text-[var(--accent)]"
      >
        <span className="text-[var(--term-dim)]">{open ? "v" : ">"}</span> MATCH CONTEXT / DEBUG
      </button>

      {open && (
        <div className="mt-3 border-t border-[var(--term-border)] pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
              PREDICTION INPUT SNAPSHOT
            </span>
            {isMock ? (
              <span className="border border-[rgba(255,180,84,.38)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-amber)]">
                MOCK DATA
              </span>
            ) : (
              <span className="border border-[rgba(56,209,124,.42)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-pos)]">
                REAL DATA
              </span>
            )}

            {hasBoth && (
              <div className="ml-auto inline-flex border border-[var(--term-border-2)]" role="tablist" aria-label="Prediction input mode">
                {([["original", "ORIGINAL"], ["blind", "BLIND"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeView === key}
                    onClick={() => setView(key)}
                    className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${activeView === key ? "bg-[#1A2330] text-white" : "text-[var(--term-muted)] hover:text-[var(--accent)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isBlind && (
            <p className="mb-3 border-l-2 border-[rgba(56,209,124,.42)] pl-3 font-mono text-[11px] leading-relaxed text-[var(--term-muted)]">
              Blind match context: exactly what the model received. No bookmaker odds are present; the odds are
              applied by deterministic code only after the model returns its probabilities.
            </p>
          )}

          <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap border border-[var(--term-border)] bg-[var(--term-surface-2)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--term-muted)]">
            {snapshot}
          </pre>
        </div>
      )}
    </div>
  );
}
