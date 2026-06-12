"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Expand, X } from "lucide-react";
import type { Fixture, Prediction } from "@/lib/api";
import ModelIcon from "@/components/ModelIcon";

const WINDOW_DAYS = 3;

type StatusFilter = "all" | "won" | "lost" | "pending";
type Model = {
  key: string;
  label: string;
  roman: string;
  code: string;
  accent: string;
  alias: string;
};
type Tally = {
  total: number;
  won: number;
  lost: number;
  pending: number;
  void: number;
  net: number;
  staked: number;
  settledStake: number;
  roi: number;
  form: string[];
};
type Detail = { model: Model; bet: Prediction } | null;

const MODELS: Model[] = [
  { key: "claude", label: "Claude", roman: "I", code: "CL", accent: "oklch(0.74 0.13 55)", alias: "The Anthropic Hand" },
  { key: "gpt5", label: "ChatGPT", roman: "II", code: "GP", accent: "oklch(0.74 0.13 165)", alias: "The Open Ledger" },
  { key: "gemini", label: "Gemini", roman: "III", code: "GM", accent: "oklch(0.74 0.13 255)", alias: "The Twin Stars" },
  { key: "grok", label: "Grok", roman: "IV", code: "GK", accent: "oklch(0.74 0.13 305)", alias: "The Drifter" },
  { key: "deepseek", label: "DeepSeek", roman: "V", code: "DS", accent: "oklch(0.74 0.13 210)", alias: "The Deep Prospector" },
];
const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "won", label: "WON" },
  { key: "lost", label: "LOST" },
  { key: "pending", label: "PENDING" },
];

const cn = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");
const accentStyle = (model: Model) => ({ "--history-accent": model.accent } as CSSProperties);
const isSettled = (bet: Prediction) => bet.status === "won" || bet.status === "lost";
const sortNewest = (a: Prediction, b: Prediction) => +new Date(b.created_at) - +new Date(a.created_at);

function fmtMoney(value: number | null | undefined, signed = false) {
  if (value === null || value === undefined) return "-";
  const sign = signed && value !== 0 ? (value > 0 ? "+" : "-") : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
}

function daysAgo(value: string) {
  const placed = new Date(value);
  const today = new Date();
  placed.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - placed.getTime()) / 86_400_000);
}

function betRef(model: Model, bet: Prediction) {
  return `${model.code}-${String(bet.id).padStart(4, "0")}`;
}

function matchOf(bet: Prediction, fixtureMap: Record<number, Fixture>) {
  const fixture = fixtureMap[bet.fixture_id];
  return fixture ? `${fixture.home_team} v ${fixture.away_team}` : `Fixture No.${bet.fixture_id}`;
}

function competitionOf(bet: Prediction, fixtureMap: Record<number, Fixture>) {
  return fixtureMap[bet.fixture_id]?.league ?? "Competition pending";
}

function wagerOf(bet: Prediction, fixtureMap: Record<number, Fixture>) {
  const fixture = fixtureMap[bet.fixture_id];
  if (bet.bet_on === "draw") return "Draw";
  if (bet.bet_on === "home") return fixture?.home_team ?? "Home win";
  return fixture?.away_team ?? "Away win";
}

function computeTally(bets: Prediction[]): Tally {
  let won = 0;
  let lost = 0;
  let pending = 0;
  let voidCount = 0;
  let net = 0;
  let staked = 0;
  let settledStake = 0;
  for (const bet of bets) {
    staked += bet.stake;
    if (bet.status === "won") won++;
    else if (bet.status === "lost") lost++;
    else if (bet.status === "pending") pending++;
    else voidCount++;
    if (isSettled(bet)) {
      settledStake += bet.stake;
      net += bet.profit_loss ?? 0;
    }
  }
  const form = bets
    .filter(isSettled)
    .sort(sortNewest)
    .slice(0, 5)
    .map((bet) => (bet.status === "won" ? "W" : "L"));
  return {
    total: bets.length,
    won,
    lost,
    pending,
    void: voidCount,
    net,
    staked,
    settledStake,
    roi: settledStake ? (net / settledStake) * 100 : 0,
    form,
  };
}

function FormPills({ form }: { form: string[] }) {
  if (!form.length) return <span className="history-form-empty">-</span>;
  return (
    <span className="history-form">
      {form.map((result, index) => <span key={`${result}-${index}`} className={cn("history-form-pill", result === "W" ? "is-win" : "is-loss")}>{result}</span>)}
    </span>
  );
}

function StatusBadge({ status }: { status: Prediction["status"] }) {
  return (
    <span className={cn("history-status", `is-${status}`)}>
      {status.toUpperCase()}
    </span>
  );
}

function Stat({ label, value, sub, tone, live }: { label: string; value: string; sub: string; tone?: string; live?: boolean }) {
  return (
    <div className="history-stat">
      <div className="history-stat-label"><i className={live ? "terminal-live-dot" : "terminal-cyan-dot"} />{label}</div>
      <div className="history-stat-value" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="history-stat-sub">{sub}</div>
    </div>
  );
}

function relativeSettled(predictions: Prediction[]) {
  const latest = predictions
    .filter(isSettled)
    .map((bet) => +(new Date(bet.settled_at ?? bet.created_at)))
    .sort((a, b) => b - a)[0];
  if (!latest) return "waiting";
  const seconds = Math.max(0, Math.floor((Date.now() - latest) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function Ticker({ models, betsByModel }: { models: Model[]; betsByModel: Record<string, Prediction[]> }) {
  return (
    <div className="history-ticker" aria-hidden="true">
      <div className="history-ticker-track">
        {[...models, ...models].map((model, index) => {
          const tally = computeTally(betsByModel[model.key]);
          return (
            <span key={`${model.key}-${index}`} className="history-ticker-item">
              <ModelIcon model={model.key} label={model.label} className="h-4 w-4 object-contain" />
              <b>{model.label.toUpperCase()}</b>
              <span className={tally.net >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(tally.net, true)}</span>
              <span className={tally.roi >= 0 ? "is-pos" : "is-neg"}>{tally.roi >= 0 ? "+" : ""}{tally.roi.toFixed(1)}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BetTable({ rows, fixtureMap, onOpen }: { rows: Prediction[]; fixtureMap: Record<number, Fixture>; onOpen: (bet: Prediction) => void }) {
  if (!rows.length) return <div className="history-empty">NO WAGERS MATCH THE CURRENT VIEW.</div>;
  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>DATE</th>
            <th>MATCH</th>
            <th className="history-hide-sm">WAGER</th>
            <th className="history-num history-hide-sm">ODDS</th>
            <th className="history-num">STAKE</th>
            <th className="history-num">P / L</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((bet) => (
            <tr key={bet.id} onClick={() => onOpen(bet)}>
              <td className="history-date">{fmtDate(bet.created_at)}</td>
              <td>
                <strong>{matchOf(bet, fixtureMap)}</strong>
                <small>{competitionOf(bet, fixtureMap)}</small>
              </td>
              <td className="history-hide-sm">
                <strong>{wagerOf(bet, fixtureMap)}</strong>
                <small>FULL TIME RESULT</small>
              </td>
              <td className="history-num history-hide-sm">{bet.odds.toFixed(2)}</td>
              <td className="history-num">{fmtMoney(bet.stake)}</td>
              <td className={cn("history-num", bet.profit_loss === null ? "is-dim" : (bet.profit_loss >= 0 ? "is-pos" : "is-neg"))}>
                {fmtMoney(bet.profit_loss, true)}
              </td>
              <td><StatusBadge status={bet.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelPanel({
  model,
  bets,
  fixtureMap,
  open,
  showAll,
  statusFilter,
  onToggle,
  onOpen,
}: {
  model: Model;
  bets: Prediction[];
  fixtureMap: Record<number, Fixture>;
  open: boolean;
  showAll: boolean;
  statusFilter: StatusFilter;
  onToggle: () => void;
  onOpen: (bet: Prediction) => void;
}) {
  const [showOlder, setShowOlder] = useState(false);
  useEffect(() => {
    if (!open) setShowOlder(false);
  }, [open]);

  const tally = computeTally(bets);
  const filtered = bets.filter((bet) => statusFilter === "all" || bet.status === statusFilter).sort(sortNewest);
  const recent = filtered.filter((bet) => daysAgo(bet.created_at) < WINDOW_DAYS);
  const older = filtered.filter((bet) => daysAgo(bet.created_at) >= WINDOW_DAYS);
  const rows = showAll || showOlder ? [...recent, ...older] : recent;

  return (
    <section className={cn("history-model-panel", open && "is-open")} style={accentStyle(model)}>
      <button type="button" className="history-model-head" aria-expanded={open} onClick={onToggle}>
        <span className="history-roman overflow-hidden p-1">
          <ModelIcon model={model.key} label={model.label} className="h-full w-full object-contain" />
        </span>
        <span className="history-model-id">
          <strong>{model.label}<em>{model.code}</em></strong>
        </span>
        <span className="history-head-stat">
          <small>WAGERS</small>
          <strong>{String(tally.total).padStart(2, "0")}</strong>
        </span>
        <span className="history-head-stat history-panel-hide-sm">
          <small>RECORD</small>
          <strong className="history-record"><b className="is-pos">{tally.won}W</b><b className="is-neg">{tally.lost}L</b><b className="is-amber">{tally.pending}P</b></strong>
        </span>
        <span className="history-head-stat history-panel-hide-sm">
          <small>FORM</small>
          <FormPills form={tally.form} />
        </span>
        <span className="history-head-stat">
          <small>NET P/L</small>
          <strong className={tally.net >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(tally.net, true)}</strong>
        </span>
        <ChevronDown className="history-chevron" size={18} aria-hidden="true" />
      </button>
      <div className="history-model-body">
        <div className="history-model-body-inner">
          <BetTable rows={rows} fixtureMap={fixtureMap} onOpen={onOpen} />
          {!showAll && older.length > 0 && (
            <button type="button" className="history-older" onClick={() => setShowOlder((current) => !current)}>
              {showOlder ? "^ COLLAPSE OLDER SHEET" : `v PULL OLDER SHEET - ${older.length} PRIOR WAGER${older.length === 1 ? "" : "S"}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function DetailModal({ detail, fixtureMap, onClose }: { detail: NonNullable<Detail>; fixtureMap: Record<number, Fixture>; onClose: () => void }) {
  const { model, bet } = detail;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const reference = betRef(model, bet);
  const settledReturn = bet.status === "lost" ? 0 : bet.stake * bet.odds;
  return (
    <div className="history-overlay" onClick={onClose}>
      <section className="history-modal" style={accentStyle(model)} role="dialog" aria-modal="true" aria-label={`Wager detail for ${matchOf(bet, fixtureMap)}`} onClick={(event) => event.stopPropagation()}>
        <header className="history-modal-head">
          <div className="flex min-w-0 items-start gap-3">
            <ModelIcon model={model.key} label={model.label} className="h-10 w-10 flex-none object-contain" />
            <div className="min-w-0">
              <small><i />{model.alias} / {model.label}</small>
              <h2>{matchOf(bet, fixtureMap)}</h2>
              <p>{competitionOf(bet, fixtureMap)} / {fmtDate(bet.created_at)} {new Date(bet.created_at).getFullYear()} / {reference}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close wager detail"><X size={15} /></button>
        </header>
        <div className="history-modal-grid">
          <ModalCell label="WAGER" value={wagerOf(bet, fixtureMap)} sub="FULL TIME RESULT" />
          <ModalCell label="STATUS" value={<StatusBadge status={bet.status} />} />
          <ModalCell label="ODDS" value={bet.odds.toFixed(2)} />
          <ModalCell label="STAKE" value={fmtMoney(bet.stake)} />
          <ModalCell label={bet.status === "pending" ? "POTENTIAL RETURN" : "SETTLED RETURN"} value={fmtMoney(settledReturn)} />
          <ModalCell label="PROFIT / LOSS" value={fmtMoney(bet.profit_loss, true)} tone={bet.profit_loss === null ? "is-dim" : bet.profit_loss >= 0 ? "is-pos" : "is-neg"} />
        </div>
        <div className="history-modal-body">
          <div className="history-section-label">OPERATOR REASONING<span /></div>
          <p>{bet.reasoning}</p>
          {bet.prompt_snapshot && (
            <>
              <div className="history-section-label">PROMPT SNAPSHOT<span /></div>
              <pre>{bet.prompt_snapshot}</pre>
            </>
          )}
        </div>
        <footer><span>REF {reference}</span><span>LOGGED / {fmtDate(bet.created_at)} {new Date(bet.created_at).getFullYear()}</span></footer>
      </section>
    </div>
  );
}

function ModalCell({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="history-modal-cell">
      <small>{label}</small>
      <strong className={tone}>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

type Props = {
  predictions: Prediction[];
  fixtureMap: Record<number, Fixture>;
};

export default function HistoryClient({ predictions, fixtureMap }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [openSet, setOpenSet] = useState(() => new Set([MODELS[0].key]));
  const [detail, setDetail] = useState<Detail>(null);
  const betsByModel = useMemo(
    () => Object.fromEntries(MODELS.map((model) => [model.key, predictions.filter((bet) => bet.model_name === model.key)])),
    [predictions],
  );
  const tallies = useMemo(
    () => Object.fromEntries(MODELS.map((model) => [model.key, computeTally(betsByModel[model.key])])),
    [betsByModel],
  );
  const totals = MODELS.reduce(
    (result, model) => {
      const tally = tallies[model.key];
      result.total += tally.total;
      result.settled += tally.won + tally.lost;
      result.pending += tally.pending;
      result.net += tally.net;
      result.staked += tally.staked;
      return result;
    },
    { total: 0, settled: 0, pending: 0, net: 0, staked: 0 },
  );
  const topModel = MODELS.reduce((best, model) => tallies[model.key].net > tallies[best.key].net ? model : best, MODELS[0]);
  const allOpen = openSet.size === MODELS.length;
  const filterCount = (filter: StatusFilter) => predictions.filter((bet) => filter === "all" || bet.status === filter).length;

  function toggleModel(key: string) {
    setOpenSet((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="terminal-content history-content">
      <header className="history-hero">
        <div className="terminal-tags">
          <span>SYS://HISTORY</span>
          <span className="is-ghost">FIFA WC 2026 + Top 5 Europe Leagues</span>
        </div>
        <h1>AI History<span /></h1>
        <p>Betting history across all AI models</p>
      </header>

      <section className="history-stats">
        <Stat label="TOTAL WAGERS" value={String(totals.total).padStart(2, "0")} sub={`${totals.settled} settled / ${totals.pending} pending`} />
        <Stat label="COMBINED P/L" value={fmtMoney(totals.net, true)} sub={`across ${fmtMoney(totals.staked)} staked`} tone={totals.net >= 0 ? "var(--term-pos)" : "var(--term-neg)"} />
        <Stat label="TOP PERFORMER" value={topModel.label} sub={`${fmtMoney(tallies[topModel.key].net, true)} net`} tone={topModel.accent} />
        <Stat label="LAST SETTLED" value={relativeSettled(predictions)} sub="next tick / auto" live />
      </section>

      <Ticker models={MODELS} betsByModel={betsByModel} />

      <div className="history-toolbar">
        <div className="history-tabs">
          {STATUS_TABS.map((tab) => (
            <button key={tab.key} type="button" aria-selected={statusFilter === tab.key} onClick={() => setStatusFilter(tab.key)}>
              {tab.label}<span>{filterCount(tab.key)}</span>
            </button>
          ))}
        </div>
        <div className="history-tools">
          <button type="button" onClick={() => setOpenSet(allOpen ? new Set() : new Set(MODELS.map((model) => model.key)))}>
            <Expand size={13} />{allOpen ? "COLLAPSE ALL" : "EXPAND ALL"}
          </button>
          <button type="button" className={showAll ? "is-on" : ""} onClick={() => setShowAll((current) => !current)}>
            {showAll ? "ALL HISTORY" : `LAST ${WINDOW_DAYS}D`}
          </button>
        </div>
      </div>

      <div className="history-model-stack">
        {MODELS.map((model) => (
          <ModelPanel
            key={model.key}
            model={model}
            bets={betsByModel[model.key]}
            fixtureMap={fixtureMap}
            open={openSet.has(model.key)}
            showAll={showAll}
            statusFilter={statusFilter}
            onToggle={() => toggleModel(model.key)}
            onOpen={(bet) => setDetail({ model, bet })}
          />
        ))}
      </div>
      <div className="history-end">. . . END OF THE DAY-BOOK . . .</div>
      {detail && <DetailModal detail={detail} fixtureMap={fixtureMap} onClose={() => setDetail(null)} />}
    </div>
  );
}
