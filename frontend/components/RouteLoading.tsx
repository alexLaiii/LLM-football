"use client";

import { useEffect, useState } from "react";

export default function RouteLoading() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 1500;

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      setPct(Math.floor(eased * 99));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="grid min-h-[70vh] place-items-center px-6 py-12 font-mono select-none">
      <div className="w-full max-w-[560px] border border-[var(--term-border)] bg-[var(--term-surface)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">SYSTEM SYNC</span>
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">ROUTE / LOADING</span>
        </div>

        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[var(--term-muted)]">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--term-cyan)] shadow-[0_0_10px_var(--term-cyan)]" />
          Fetching interface state...
        </div>

        <div className="h-1.5 border border-[var(--term-border)] bg-[var(--term-surface-2)]">
          <div
            className="h-full bg-[var(--accent)] transition-[width] duration-100 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-4 grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[42px_1fr_68px] items-center gap-3">
              <span className="h-2 bg-[var(--term-border-2)]" />
              <span className="h-2 bg-[var(--term-surface-2)]" />
              <span className="h-2 bg-[var(--term-border-2)]" />
            </div>
          ))}
        </div>

        <div className="mt-4 text-[10px] uppercase tracking-[0.14em] text-[var(--term-dim)]">
          // Hydrating page modules / {pct}% complete
        </div>
      </div>
    </div>
  );
}
