"use client";

import { useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/api";
import ModelIcon, { modelIconSrc } from "@/components/ModelIcon";

const START_BANKROLL = 20_000;
const MINUS = "−";
const MARK_HUES: Record<string, number> = { claude: 18, gpt5: 158, gemini: 220, grok: 330, deepseek: 248 };

type FilterKind = "all" | "ai" | "human" | "all_blind" | "ai_blind";
type SortKey = "rank" | "name" | "form" | "type" | "bankroll" | "pl" | "roi" | "win" | "record";
type SortDir = "asc" | "desc";

// Which competitors belong to each filter. "ALL"/"AI" exclude blind models to
// preserve the original board; the two blind filters surface them explicitly.
const FILTERS: [FilterKind, string][] = [
  ["all", "ALL"],
  ["ai", "AI"],
  ["human", "HUMANS"],
  ["all_blind", "ALL (WITH AI BLIND)"],
  ["ai_blind", "AI (BLIND)"],
];

function inPopulation(competitor: LeaderboardEntry, filter: FilterKind): boolean {
  const blind = !!competitor.blind;
  const ai = competitor.kind === "ai";
  switch (filter) {
    case "all": return competitor.kind === "user" || (ai && !blind);
    case "ai": return ai && !blind;
    case "human": return competitor.kind === "user";
    case "all_blind": return true;
    case "ai_blind": return ai && blind;
  }
}

const fmtMoney = (n: number, signed = false, decimals = 2) => {
  const body = "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = signed ? (n >= 0 ? "+" : MINUS) : n < 0 ? MINUS : "";
  return sign + body;
};
const fmtPct = (n: number, signed = false) => {
  const p = n * 100;
  return (signed ? (p >= 0 ? "+" : MINUS) : p < 0 ? MINUS : "") + Math.abs(p).toFixed(1) + "%";
};
const fmtRecord = (c: LeaderboardEntry) => [c.won + "W", c.lost + "L", c.pending ? c.pending + "P" : ""].filter(Boolean).join(" · ");
const pnlOf = (c: LeaderboardEntry) => c.total_profit_loss ?? c.bankroll - START_BANKROLL;
const cn = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

function ModelMark({ competitor, size = 36 }: { competitor: LeaderboardEntry; size?: number }) {
  if (competitor.kind === "user") {
    return <span className="terminal-mark is-human" style={{ width: size, height: size }}><UserRound size={Math.round(size * 0.5)} /></span>;
  }
  const hue = MARK_HUES[competitor.name] ?? 200;
  return (
    <span
      className="terminal-mark is-ai"
      style={{
        width: size,
        height: size,
        background: `oklch(0.32 0.06 ${hue})`,
        borderColor: `oklch(0.55 0.14 ${hue})`,
        color: `oklch(0.92 0.10 ${hue})`,
      }}
      title={`${competitor.display_name} model mark placeholder`}
    >
      {modelIconSrc(competitor.name) ? (
        <ModelIcon model={competitor.name} label={competitor.display_name} className="h-[68%] w-[68%] object-contain" />
      ) : (
        competitor.display_name.charAt(0).toUpperCase()
      )}
      <span className="terminal-mark-ring" />
    </span>
  );
}

function FormChips({ form }: { form?: string[] }) {
  const results = (form ?? []).filter((result) => result === "W" || result === "L").slice(-5);
  if (!results.length) return <span className="terminal-form-empty">no results yet</span>;
  return <span className="terminal-form">{results.map((result, i) => <span key={i} className={cn("terminal-chip", result === "W" ? "is-win" : "is-loss")}>{result}</span>)}</span>;
}

function TypePill({ kind }: { kind: LeaderboardEntry["kind"] }) {
  return <span className={cn("terminal-type-pill", kind === "ai" ? "is-ai" : "is-human")}>{kind === "ai" ? "AI" : "HUMAN"}</span>;
}

function RoiPill({ value }: { value: number }) {
  return <span className={cn("terminal-roi-pill", value >= 0 ? "is-pos" : "is-neg")}>{fmtPct(value, true)}</span>;
}

function DeltaBar({ value, mobile = false }: { value: number; mobile?: boolean }) {
  const amount = Math.min(1, Math.abs(value) / 5000) * 50;
  return (
    <span className={cn("terminal-delta-bar", mobile && "is-mobile")}>
      <span className="terminal-delta-zero" />
      <span className={cn("terminal-delta-fill", value >= 0 ? "is-pos" : "is-neg")} style={{ width: `${amount}%` }} />
    </span>
  );
}

function Record({ competitor }: { competitor: LeaderboardEntry }) {
  return <span className="terminal-record">{fmtRecord(competitor)}</span>;
}

function LoadingState() {
  return (
    <div className="terminal-loading">
      <div className="terminal-loading-status">
        <span>FETCHING TICK · /api/leaderboard</span>
        <span className="terminal-loading-progress"><span /></span>
        <span>~600ms</span>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="terminal-skeleton-row" style={{ animationDelay: `${i * 80}ms` }}>
          <span /><span className="is-avatar" /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="terminal-empty">
      <div className="terminal-empty-icon">∅</div>
      <h3>NO SETTLED BETS // BOARD ZERO</h3>
      <p>The competition has loaded. Every operator, five AI models and the human field, starts even at <b>$20,000.00</b>. The first tick lands the moment a match settles.</p>
      <div className="terminal-empty-meta">WAITING FOR TICK <span className="terminal-live-dot" /></div>
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "rank", label: "#" },
  { key: "name", label: "PLAYER" },
  { key: "form", label: "FORM" },
  { key: "type", label: "TYPE" },
  { key: "bankroll", label: "BANKROLL", align: "right" },
  { key: "pl", label: "P&L", align: "right" },
  { key: "roi", label: "ROI", align: "right" },
  { key: "win", label: "WIN%", align: "right" },
  { key: "record", label: "RECORD", align: "right" },
];

function DesktopRow({ competitor, rank, flashing }: { competitor: LeaderboardEntry; rank: number; flashing: boolean }) {
  const pnl = pnlOf(competitor);
  return (
    <div className={cn("terminal-table-row", rank === 1 && "is-leader", flashing && "is-flash")}>
      <div className="terminal-rank">{String(rank).padStart(2, "0")}{rank === 1 && <span>★</span>}</div>
      <div className="terminal-player"><ModelMark competitor={competitor} /><span><strong>{competitor.display_name}</strong><small>{competitor.kind === "ai" ? "MODEL" : "HUMAN"} · ID: {competitor.name}</small></span></div>
      <FormChips form={competitor.recent_form} />
      <TypePill kind={competitor.kind} />
      <div className="terminal-cell-right">{fmtMoney(competitor.bankroll)}</div>
      <div className="terminal-pnl terminal-cell-right"><DeltaBar value={pnl} /><span className={pnl >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(pnl, true)}</span></div>
      <div className="terminal-cell-right"><RoiPill value={competitor.roi} /></div>
      <div className="terminal-cell-right">{fmtPct(competitor.win_rate)}</div>
      <div className="terminal-cell-right"><Record competitor={competitor} /></div>
    </div>
  );
}

function MobileCard({ competitor, rank, flashing }: { competitor: LeaderboardEntry; rank: number; flashing: boolean }) {
  const pnl = pnlOf(competitor);
  return (
    <div className={cn("terminal-mobile-card", rank === 1 && "is-leader", flashing && "is-flash")}>
      <div className="terminal-mobile-card-head">
        <span className="terminal-mobile-rank">{String(rank).padStart(2, "0")}</span>
        <ModelMark competitor={competitor} size={42} />
        <span className="terminal-mobile-id"><strong>{competitor.display_name}</strong><small>{competitor.kind === "ai" ? "MODEL" : "HUMAN"} · ID: {competitor.name}</small></span>
        <TypePill kind={competitor.kind} />
      </div>
      <div className="terminal-mobile-stats">
        <span><small>BANKROLL</small><strong>{fmtMoney(competitor.bankroll)}</strong></span>
        <span><small>P&L</small><strong className={pnl >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(pnl, true)}</strong></span>
        <span><small>ROI</small><strong className={competitor.roi >= 0 ? "is-pos" : "is-neg"}>{fmtPct(competitor.roi, true)}</strong></span>
        <span><small>WIN%</small><strong>{fmtPct(competitor.win_rate)}</strong></span>
        <span><small>RECORD</small><strong><Record competitor={competitor} /></strong></span>
        <span><small>FORM</small><FormChips form={competitor.recent_form} /></span>
      </div>
      <DeltaBar value={pnl} mobile />
    </div>
  );
}

export default function LeaderboardTable({ data, loading = false, flashSet = {} }: {
  data: LeaderboardEntry[]; loading?: boolean; flashSet?: Record<string, boolean>;
}) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sortKey, setSortKey] = useState<SortKey>("bankroll");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [key, data.filter((c) => inPopulation(c, key)).length])) as Record<FilterKind, number>,
    [data],
  );
  // Ranks are recomputed over the selected filter's population so visible ranks
  // are 1..N for what's shown, never preserving hidden entries' numbers.
  const filtered = useMemo(() => data.filter((c) => inPopulation(c, filter)), [data, filter]);
  const ranks = useMemo(() => Object.fromEntries([...filtered].sort((a, b) => b.bankroll - a.bankroll).map((c, i) => [c.name, i + 1])), [filtered]);
  const visible = useMemo(() => {
    const value = (c: LeaderboardEntry): number | string => {
      switch (sortKey) {
        case "rank": return ranks[c.name];
        case "name": return c.display_name.toLowerCase();
        case "form": return (c.recent_form ?? []).filter((r) => r === "W").length;
        case "type": return c.kind;
        case "pl": return pnlOf(c);
        case "roi": return c.roi;
        case "win": return c.win_rate;
        case "record": return c.won;
        default: return c.bankroll;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = value(a), bv = value(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? av - (bv as number) : (bv as number) - av;
    });
  }, [filtered, ranks, sortDir, sortKey]);

  function sortBy(key: SortKey) {
    if (sortKey === key) setSortDir((dir) => dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "type" ? "asc" : "desc");
    }
  }

  return (
    <section className="terminal-board">
      <div className="terminal-board-top">
        <div className="terminal-tabs" role="tablist">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
              {label}<span>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="terminal-sort-hint">SORT · {sortKey.toUpperCase()} · {sortDir.toUpperCase()}</div>
      </div>
      {loading ? <LoadingState /> : data.length === 0 ? <EmptyState /> : (
        <>
          <div className="terminal-desktop-table">
            <div className="terminal-table-head">
              {COLUMNS.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  className={cn(column.align === "right" && "terminal-cell-right", sortKey === column.key && "is-active")}
                  onClick={() => sortBy(column.key)}
                  aria-sort={sortKey === column.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {column.label}<span>{sortKey === column.key ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
              ))}
            </div>
            {visible.map((competitor) => <DesktopRow key={competitor.name} competitor={competitor} rank={ranks[competitor.name]} flashing={!!flashSet[competitor.name]} />)}
          </div>
          <div className="terminal-mobile-list">
            {visible.map((competitor) => <MobileCard key={competitor.name} competitor={competitor} rank={ranks[competitor.name]} flashing={!!flashSet[competitor.name]} />)}
          </div>
        </>
      )}
    </section>
  );
}
