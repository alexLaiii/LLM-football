import type { CSSProperties } from "react";

function SkeletonPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px] ${className}`}>
      <div className="mb-4 h-3 w-40 bg-[var(--term-border-2)]" />
      <div className="space-y-3">
        <div className="h-8 w-full bg-[var(--term-surface-2)]" />
        <div className="h-8 w-4/5 bg-[var(--term-surface-2)]" />
        <div className="h-8 w-2/3 bg-[var(--term-surface-2)]" />
      </div>
    </div>
  );
}

function ModelSkeleton() {
  return (
    <div className="border border-[var(--term-border)] bg-[var(--term-surface)]">
      <div className="border-t-2 border-[var(--term-cyan)] p-4">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 border border-[var(--term-border-2)] bg-[var(--term-surface-2)]" />
          <div className="h-4 w-28 bg-[var(--term-border-2)]" />
          <div className="ml-auto h-6 w-20 border border-[rgba(255,180,84,.35)]" />
        </div>
      </div>
      <div className="grid gap-3 border-t border-[var(--term-border)] p-4">
        {[72, 44, 28].map((width) => (
          <div key={width} className="grid grid-cols-[42px_1fr_44px] items-center gap-3">
            <div className="h-3 bg-[var(--term-border-2)]" />
            <div className="h-1.5 border border-[var(--term-border)] bg-[var(--term-surface-2)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${width}%` }} />
            </div>
            <div className="h-3 bg-[var(--term-border-2)]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 border-t border-[var(--term-border)]">
        <div className="h-14 border-r border-[var(--term-border)] bg-[var(--term-surface-2)]" />
        <div className="h-14 border-r border-[var(--term-border)] bg-[var(--term-surface-2)]" />
        <div className="h-14 bg-[var(--term-surface-2)]" />
      </div>
    </div>
  );
}

export default function MatchDetailLoading() {
  return (
    <div className="terminal-page min-h-screen" style={{ "--accent": "var(--term-pos)" } as CSSProperties}>
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-[18px] px-7 pb-20 pt-[18px] lg:grid-cols-[360px_1fr]">
        <aside className="grid gap-3.5 lg:sticky lg:top-[18px]">
          <SkeletonPanel className="min-h-[240px]" />
          <SkeletonPanel className="min-h-[200px]" />
          <SkeletonPanel className="min-h-[150px]" />
        </aside>
        <main className="grid gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">AI PREDICTIONS</span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// LOADING MATCH DETAIL</span>
          </div>
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <ModelSkeleton key={index} />
            ))}
          </div>
          <div className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">STARTING LINEUPS</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// SYNCING FORMATION DATA</span>
            </div>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="aspect-[1.05] border border-[var(--term-border)] bg-[repeating-linear-gradient(0deg,#0d1410_0_12.5%,#0f1712_12.5%_25%)]" />
              <div className="aspect-[1.05] border border-[var(--term-border)] bg-[repeating-linear-gradient(0deg,#0d1410_0_12.5%,#0f1712_12.5%_25%)]" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
