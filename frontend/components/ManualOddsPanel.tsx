"use client";

// TEMPORARY: manual odds entry for local testing. When the bookmaker feed has
// no line, enter decimal odds here to run predictions (and make the match
// bettable, since the stored line is then reused). Remove this component and its
// usage in MatchDetailClient to revert.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { triggerManualOddsPredictions } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function ManualOddsPanel({ fixtureId }: { fixtureId: number }) {
  const router = useRouter();
  const { token } = useAuth();
  const [home, setHome] = useState("");
  const [draw, setDraw] = useState("");
  const [away, setAway] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    const values = { home: parseFloat(home), draw: parseFloat(draw), away: parseFloat(away) };
    if (!Object.values(values).every((v) => Number.isFinite(v) && v > 1.0)) {
      setError("Enter decimal odds > 1.0 for home, draw and away.");
      return;
    }
    if (!token) {
      setError("Sign in to use manual odds.");
      return;
    }
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await triggerManualOddsPredictions(token, fixtureId, values);
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start predictions.");
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">{label}</span>
      <input
        type="number"
        step="0.01"
        min="1.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="0.00"
        className="w-full border border-[var(--term-border)] bg-[var(--term-surface-2)] px-2 py-1.5 font-mono text-sm tabular-nums text-[var(--term-text)] outline-none focus:border-[var(--term-amber)]"
      />
    </label>
  );

  return (
    <section className="border border-[rgba(255,180,84,.42)] bg-[var(--term-surface)] p-[14px]">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-amber)]">MANUAL ODDS</span>
        <span className="border border-[rgba(255,180,84,.42)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--term-amber)]">TEMP</span>
      </div>
      <p className="mb-3 font-mono text-[10px] leading-relaxed text-[var(--term-dim)]">
        Overrides the bookmaker line. Entering odds replaces existing predictions and re-runs the models with these odds; betting uses them too.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {field("HOME", home, setHome)}
        {field("DRAW", draw, setDraw)}
        {field("AWAY", away, setAway)}
      </div>
      {error && <div className="mt-2 font-mono text-[10.5px] text-[var(--term-neg)]">{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-3 w-full border border-[var(--term-amber)] bg-[rgba(255,180,84,.12)] px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--term-amber)] transition-colors hover:bg-[rgba(255,180,84,.2)] disabled:opacity-50"
      >
        {done ? "OVERRIDE APPLIED — RE-RUNNING..." : busy ? "STARTING..." : "OVERRIDE ODDS & RE-RUN PREDICTIONS"}
      </button>
    </section>
  );
}
