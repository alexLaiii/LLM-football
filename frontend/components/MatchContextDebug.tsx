"use client";

import { useState } from "react";
import type { Prediction } from "@/lib/api";

export default function MatchContextDebug({ predictions }: { predictions: Prediction[] }) {
  const [open, setOpen] = useState(false);

  const snapshot = predictions.find((p) => p.prompt_snapshot)?.prompt_snapshot;
  if (!snapshot) return null;

  const isMock = snapshot.includes("(MOCK)");

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
          <div className="mb-3 flex items-center gap-2">
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
          </div>
          <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap border border-[var(--term-border)] bg-[var(--term-surface-2)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--term-muted)]">
            {snapshot}
          </pre>
        </div>
      )}
    </div>
  );
}
