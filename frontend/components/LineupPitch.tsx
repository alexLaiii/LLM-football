"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { getLineupDetails, type LineupDetails, type LineupPlayer, type TeamLineup } from "@/lib/api";

type Row = { row: number; players: (LineupPlayer & { col: number })[] };

function buildRowsFromGrid(players: LineupPlayer[]): Row[] | null {
  const rows: Record<number, (LineupPlayer & { col: number })[]> = {};
  for (const p of players) {
    if (!p.grid) return null;
    const [rStr, cStr] = p.grid.split(":");
    const r = parseInt(rStr, 10);
    const c = parseInt(cStr, 10);
    if (isNaN(r) || isNaN(c)) return null;
    (rows[r] ??= []).push({ ...p, col: c });
  }
  return Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b)
    .map((row) => ({
      row,
      players: rows[row].sort((a, b) => a.col - b.col),
    }));
}

function buildRowsFromPos(players: LineupPlayer[]): Row[] | null {
  const buckets: Record<string, LineupPlayer[]> = { G: [], D: [], M: [], F: [] };
  for (const p of players) {
    const k = (p.pos || "").toUpperCase();
    if (k in buckets) buckets[k].push(p);
  }
  const order: Array<["G" | "D" | "M" | "F", number]> = [["G", 1], ["D", 2], ["M", 3], ["F", 4]];
  const rows: Row[] = [];
  for (const [k, row] of order) {
    if (buckets[k].length) {
      rows.push({
        row,
        players: buckets[k].map((p, i) => ({ ...p, col: i + 1 })),
      });
    }
  }
  return rows.length ? rows : null;
}

function PitchLines() {
  return (
    <>
      <div className="absolute left-[10%] right-[10%] top-1/2 h-px bg-[var(--term-border-2)]" />
      <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--term-border-2)]" />
      <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--term-border-2)]" />
      <div className="absolute left-1/2 top-0 h-[13%] w-[34%] -translate-x-1/2 border-x border-b border-[var(--term-border-2)]" />
      <div className="absolute left-1/2 top-0 h-[6%] w-[18%] -translate-x-1/2 border-x border-b border-[var(--term-border-2)]" />
      <div className="absolute bottom-0 left-1/2 h-[13%] w-[34%] -translate-x-1/2 border-x border-t border-[var(--term-border-2)]" />
      <div className="absolute bottom-0 left-1/2 h-[6%] w-[18%] -translate-x-1/2 border-x border-t border-[var(--term-border-2)]" />
    </>
  );
}

function PlayerDot({ player }: { player: LineupPlayer }) {
  return (
    <div className="flex flex-col items-center" style={{ width: "20%" }} title={player.name}>
      <div className="h-[11px] w-[11px] rounded-full bg-[var(--lineup-accent)] opacity-90 shadow-[0_0_8px_-2px_var(--lineup-accent)]" />
    </div>
  );
}

function PlaceholderDot() {
  return (
    <div className="flex flex-col items-center" style={{ width: "20%" }}>
      <div className="h-[11px] w-[11px] rounded-full bg-[var(--lineup-accent)] opacity-90 shadow-[0_0_8px_-2px_var(--lineup-accent)]" />
    </div>
  );
}

function PitchSurface({ rows, muted = false }: { rows: Row[] | null; muted?: boolean }) {
  return (
    <div className="relative aspect-[1.05] overflow-hidden border border-[var(--term-border)] bg-[repeating-linear-gradient(0deg,#0d1410_0_12.5%,#0f1712_12.5%_25%)] py-2.5">
      <PitchLines />
      {rows && rows.length > 0 ? (
        <div className={`absolute inset-0 flex flex-col-reverse justify-around py-2 ${muted ? "opacity-90" : ""}`}>
          {rows.map((r) => (
            <div key={r.row} className="flex items-center justify-around">
              {r.players.map((p, i) => (
                p.name ? <PlayerDot key={`${p.name}-${i}`} player={p} /> : <PlaceholderDot key={i} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Pitch({ lineup, accent }: { lineup: TeamLineup; accent: string }) {
  const rows = buildRowsFromGrid(lineup.players) ?? buildRowsFromPos(lineup.players);

  return (
    <div className="border border-[var(--term-border)] bg-[var(--term-surface-2)] p-3" style={{ "--lineup-accent": accent } as CSSProperties}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="truncate font-mono text-sm font-semibold text-[var(--term-text)]">{lineup.team}</span>
        <span className="border border-[var(--term-border-2)] bg-[var(--term-surface)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-muted)]">{lineup.formation || "--"}</span>
      </div>
      <PitchSurface rows={rows} />
    </div>
  );
}

const PLACEHOLDER_ROWS: Row[] = [
  { row: 1, players: [{ name: "", number: null, pos: "G", grid: null, col: 1 }] },
  { row: 2, players: Array.from({ length: 4 }, (_, i) => ({ name: "", number: null, pos: "D", grid: null, col: i + 1 })) },
  { row: 3, players: Array.from({ length: 3 }, (_, i) => ({ name: "", number: null, pos: "M", grid: null, col: i + 1 })) },
  { row: 4, players: Array.from({ length: 3 }, (_, i) => ({ name: "", number: null, pos: "F", grid: null, col: i + 1 })) },
];

function PlaceholderPitch({ teamName, accent }: { teamName: string; accent: string }) {
  return (
    <div className="border border-[var(--term-border)] bg-[var(--term-surface-2)] p-3" style={{ "--lineup-accent": accent } as CSSProperties}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="truncate font-mono text-sm font-semibold text-[var(--term-text)]">{teamName}</span>
        <span className="border border-[var(--term-border-2)] bg-[var(--term-surface)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-muted)]">4-3-3</span>
      </div>
      <PitchSurface rows={PLACEHOLDER_ROWS} muted />
    </div>
  );
}

function hasValidPlayers(team: TeamLineup | null): team is TeamLineup {
  return !!team && Array.isArray(team.players) && team.players.some((p) => p.name);
}

const LINEUP_POLL_MINUTES = [40, 35, 30, 25, 20, 15, 10, 5, 1];

export default function LineupsSection({
  fixtureId,
  homeTeam,
  awayTeam,
  kickoffAt,
}: {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}) {
  const [data, setData] = useState<LineupDetails | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    async function load() {
      if (cancelled) return;
      const d = await getLineupDetails(fixtureId);
      if (cancelled) return;
      setData(d);
      setLoaded(true);
      if (hasValidPlayers(d?.home ?? null) && hasValidPlayers(d?.away ?? null)) {
        timeouts.forEach(clearTimeout);
      }
    }

    load();

    const kickoffMs = new Date(kickoffAt).getTime();
    if (!isNaN(kickoffMs)) {
      const now = Date.now();
      for (const min of LINEUP_POLL_MINUTES) {
        const delay = kickoffMs - min * 60000 - now;
        if (delay > 0) timeouts.push(setTimeout(load, delay));
      }
    }

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, [fixtureId, kickoffAt]);

  const home = hasValidPlayers(data?.home ?? null) ? data!.home : null;
  const away = hasValidPlayers(data?.away ?? null) ? data!.away : null;
  const anyMissing = !home || !away;

  return (
    <section className="mt-10 border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">STARTING LINEUPS</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// XI UNCONFIRMED / PROJECTED FORMATION</span>
      </div>
      {!loaded ? (
        <div className="font-mono text-sm text-[var(--term-muted)]">Loading lineups...</div>
      ) : (
        <>
          {anyMissing && (
            <div className="mb-3 border border-[rgba(255,180,84,.35)] bg-[rgba(255,180,84,.07)] px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--term-amber)]">
              // Starting XI unavailable / showing placeholder formation
            </div>
          )}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {home ? <Pitch lineup={home} accent="var(--term-pos)" /> : <PlaceholderPitch teamName={homeTeam} accent="var(--term-pos)" />}
            {away ? <Pitch lineup={away} accent="var(--term-neg)" /> : <PlaceholderPitch teamName={awayTeam} accent="var(--term-neg)" />}
          </div>
        </>
      )}
    </section>
  );
}
