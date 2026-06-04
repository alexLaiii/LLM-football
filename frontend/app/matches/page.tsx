"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { ApiError, getFixtures, getLeaderboard, getLineupAvailable, getMyBets, syncFixtures, type Fixture, type LeaderboardEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTeamColors, type TeamTheme } from "@/lib/useTeamColors";

const LINEUP_CHECK_MINUTES = [40, 35, 30, 25, 20, 15, 10, 5, 1];
const FALLBACK_THEMES: TeamTheme[] = [
  { primary: "#0A6B43", secondary: "#123A2C" },
  { primary: "#0F3A8C", secondary: "#15264C" },
  { primary: "#B7242C", secondary: "#4A171B" },
  { primary: "#6E1136", secondary: "#311124" },
  { primary: "#5AA9DC", secondary: "#16284F" },
];
const MINUS = "−";

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
const fmtMoney = (value: number) => `${value >= 0 ? "+" : MINUS}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtPct = (value: number) => `${value >= 0 ? "+" : MINUS}${Math.abs(value * 100).toFixed(1)}%`;

function hashFallback(team: string): TeamTheme {
  const hash = [...team.toLowerCase()].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return FALLBACK_THEMES[hash % FALLBACK_THEMES.length];
}

function teamCode(team: string) {
  const words = team.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : words[0]?.slice(0, 3) ?? "?").slice(0, 3).toUpperCase();
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayLabel(date: Date, today: Date) {
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (dateKey(date) === dateKey(today)) return "Today";
  if (dateKey(date) === dateKey(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function kickoffLabel(iso: string, today: Date) {
  const date = new Date(iso);
  return `${dayLabel(date, today)} · ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function countdown(iso: string, now: Date) {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return { text: "KICKOFF", tone: "soon" };
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 24 * 60) return { text: `T-${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`, tone: "" };
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, "0");
  const seconds = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return { text: hours ? `T-${hours}:${mins}:${seconds}` : `T-${mins}:${seconds}`, tone: minutes <= 15 ? "soon" : minutes <= 35 ? "urgent" : "" };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useLineupAvailable(fixtureId: number, kickoffAt: string) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const kickoffMs = new Date(kickoffAt).getTime();
    if (!Number.isFinite(kickoffMs)) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const check = async () => {
      if (cancelled) return;
      try {
        if (await getLineupAvailable(fixtureId)) setAvailable(true);
      } catch { /* keep pending */ }
    };
    const now = Date.now();
    if (kickoffMs > now && kickoffMs - now <= 40 * 60_000) check();
    for (const minute of LINEUP_CHECK_MINUTES) {
      const delay = kickoffMs - minute * 60_000 - now;
      if (delay > 0) timers.push(setTimeout(check, delay));
    }
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [fixtureId, kickoffAt]);
  return available;
}

function Crest({ src, name, theme }: { src: string | null; name: string; theme: TeamTheme }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="matches-crest" style={{ background: `linear-gradient(150deg, ${theme.primary}, ${theme.secondary})` }}>
      {src && !failed ? <img src={src} alt={name} onError={() => setFailed(true)} /> : teamCode(name)}
    </span>
  );
}

function Ticker({ rows }: { rows: LeaderboardEntry[] }) {
  return (
    <div className="matches-ticker" aria-hidden="true">
      <div className="matches-ticker-track">
        {[...rows, ...rows].map((row, index) => (
          <span className="matches-ticker-item" key={`${row.name}-${index}`}>
            <span className={row.kind === "ai" ? "is-model" : ""}>{row.display_name.toUpperCase()}</span>
            <b className={row.total_profit_loss >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(row.total_profit_loss)}</b>
            <b className={row.roi >= 0 ? "is-pos" : "is-neg"}>{fmtPct(row.roi)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

type Option = { value: string; label: string; count?: number };

function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} className={cn("matches-filter", open && "is-open")}>
      <button type="button" className={cn("matches-filter-button", value !== "all" && "is-active")} onClick={() => setOpen((isOpen) => !isOpen)}>
        <span><small>{label}</small><strong>{current.label}</strong></span><b>▾</b>
      </button>
      {open && (
        <div className="matches-filter-menu">
          {options.map((option) => (
            <button key={option.value} type="button" className={value === option.value ? "is-selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
              <span>{option.label}</span>{option.count !== undefined && <small>{option.count}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SyncButton({
  syncing,
  lastSync,
  notice,
  cooldownSeconds,
  onClick,
}: {
  syncing: boolean;
  lastSync: string;
  notice: string;
  cooldownSeconds: number;
  onClick: () => void;
}) {
  const coolingDown = cooldownSeconds > 0;
  return (
    <button type="button" className={cn("matches-sync", syncing && "is-syncing")} disabled={syncing || coolingDown} onClick={onClick}>
      <RefreshCw size={16} />
      <span>
        <strong>{syncing ? "Syncing..." : coolingDown ? "Cooling Down" : "Sync Fixtures"}</strong>
        <small>{syncing ? "Pulling fixtures" : coolingDown ? `Try again in ${cooldownSeconds}s` : notice || `Last synced ${lastSync}`}</small>
      </span>
    </button>
  );
}

function LeagueDivider({ league, count }: { league: string; count: number }) {
  return (
    <div className="matches-league-divider">
      <strong>{league}</strong>
      <small>{count} {count === 1 ? "fixture" : "fixtures"}</small>
      <i />
    </div>
  );
}

function ScheduleCard({ fixture, placed, now, today }: { fixture: Fixture; placed: boolean; now: Date; today: Date }) {
  const lineupAvailable = useLineupAvailable(fixture.id, fixture.kickoff_at);
  const homeFallback = useMemo(() => hashFallback(fixture.home_team), [fixture.home_team]);
  const awayFallback = useMemo(() => hashFallback(fixture.away_team), [fixture.away_team]);
  const home = useTeamColors(fixture.home_team_crest, homeFallback);
  const away = useTeamColors(fixture.away_team_crest, awayFallback);
  const timer = countdown(fixture.kickoff_at, now);
  return (
    <article className="matches-card">
      <div className="matches-card-accent" style={{ background: `linear-gradient(90deg, ${home.primary}, ${away.primary})` }} />
      <div className="matches-split">
        <div className="matches-split-home" style={{ background: `linear-gradient(158deg, ${home.primary} 0%, ${home.primary} 42%, ${home.secondary} 100%)` }} />
        <div className="matches-split-away" style={{ background: `linear-gradient(202deg, ${away.primary} 0%, ${away.primary} 42%, ${away.secondary} 100%)` }} />
        <div className="matches-split-grain" /><div className="matches-split-fade" />
        <span className="matches-fixture-number">No. {String(fixture.id).padStart(3, "0")}</span>
        {placed && <span className="matches-placed">PLACED</span>}
        <div className="matches-split-content">
          <span><Crest src={fixture.home_team_crest} name={fixture.home_team} theme={home} /><strong>{fixture.home_team}</strong></span>
          <b>VS</b>
          <span><Crest src={fixture.away_team_crest} name={fixture.away_team} theme={away} /><strong>{fixture.away_team}</strong></span>
        </div>
        <div className="matches-split-meta"><span>{fixture.league}</span><strong>{kickoffLabel(fixture.kickoff_at, today)}</strong></div>
      </div>
      <div className="matches-card-body">
        <div className="matches-card-meta">
          <span className={cn("matches-lineup", lineupAvailable ? "is-confirmed" : "is-pending")}><i />{lineupAvailable ? "Starting XI confirmed" : "Lineup pending"}</span>
          <span className={cn("matches-countdown", timer.tone)}>{timer.text}</span>
        </div>
        <div className="matches-card-kickoff">
          <span><strong>{kickoffLabel(fixture.kickoff_at, today)}</strong><small>Kickoff · local time</small></span>
          <b>{fixture.league}</b>
        </div>
        <div className="matches-card-actions">
          <Link href={`/matches/${fixture.id}`}>View Odds</Link>
          <Link href={`/matches/${fixture.id}`} style={{ background: `linear-gradient(90deg, ${home.primary}, ${away.primary})` }}>Place Your Bet</Link>
        </div>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <>
      <div className="matches-loading-banner"><i />FETCHING FIXTURES · polling api/fixtures …</div>
      <div className="matches-skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => <div className="matches-skeleton" key={index}><div /><span /><span /><span /></div>)}
      </div>
    </>
  );
}

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="matches-empty">
      <span>{filtered ? "⊘" : "∅"}</span>
      <h2>{filtered ? "No fixtures match your filters" : "No fixtures on the board"}</h2>
      <p>{filtered ? "Nothing lines up with this competition and date combination. Widen the date window or switch competition to see more matches." : "The fixture feed is empty right now. New matches are posted as soon as they are confirmed. Try syncing fixtures or check back shortly."}</p>
      {filtered && <button type="button" onClick={onReset}><RotateCcw size={13} />Clear filters</button>}
    </div>
  );
}

export default function MatchesPage() {
  const { token } = useAuth();
  const now = useClock();
  const today = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => { const end = new Date(today); end.setDate(end.getDate() + 14); return end; }, [today]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [standings, setStandings] = useState<LeaderboardEntry[]>([]);
  const [placed, setPlaced] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("—");
  const [syncNotice, setSyncNotice] = useState("");
  const [syncCooldownUntil, setSyncCooldownUntil] = useState<number | null>(null);
  const [league, setLeague] = useState("all");
  const [date, setDate] = useState("all");
  const syncCooldownSeconds = syncCooldownUntil ? Math.max(0, Math.ceil((syncCooldownUntil - now.getTime()) / 1000)) : 0;

  const cleanFixtures = (rows: Fixture[]) => rows.filter((fixture) => !fixture.external_id.startsWith("mock_") && new Date(fixture.kickoff_at).getTime() > Date.now() - 90 * 60_000);
  useEffect(() => {
    Promise.all([getFixtures(), getLeaderboard()]).then(([fixtureRows, leaderboardRows]) => {
      setFixtures(cleanFixtures(fixtureRows));
      setStandings(leaderboardRows);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!token) { setPlaced(new Set()); return; }
    let cancelled = false;
    getMyBets(token).then((bets) => { if (!cancelled) setPlaced(new Set(bets.map((bet) => bet.fixture_id))); });
    return () => { cancelled = true; };
  }, [token]);

  async function handleSync() {
    if (syncCooldownUntil && syncCooldownUntil > Date.now()) return;
    setSyncing(true);
    setSyncNotice("");
    try {
      const added = await syncFixtures();
      setFixtures((current) => cleanFixtures([...current, ...added.filter((fixture) => !current.some((row) => row.id === fixture.id))]).sort((a, b) => +new Date(a.kickoff_at) - +new Date(b.kickoff_at)));
      setLastSync(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
      setSyncNotice(added.length ? `${added.length} new fixtures loaded` : "Fixture feed is already current");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const seconds = err.retryAfter ?? 60;
        setSyncCooldownUntil(Date.now() + seconds * 1000);
        setSyncNotice("Sync is cooling down to protect the API");
      } else {
        setSyncNotice("Sync could not complete. Please try again shortly.");
      }
    } finally {
      setSyncing(false);
    }
  }

  const upcoming = useMemo(() => fixtures.filter((fixture) => { const kickoff = new Date(fixture.kickoff_at); return kickoff >= today && kickoff < windowEnd; }), [fixtures, today, windowEnd]);
  const leagues = useMemo(() => [...new Set(upcoming.map((fixture) => fixture.league))].sort(), [upcoming]);
  const dates = useMemo(() => [...new Set(upcoming.map((fixture) => dateKey(new Date(fixture.kickoff_at))))].sort(), [upcoming]);
  const leagueOptions = [{ value: "all", label: "All competitions", count: upcoming.length }, ...leagues.map((item) => ({ value: item, label: item, count: upcoming.filter((fixture) => fixture.league === item).length }))];
  const dateOptions = [{ value: "all", label: "All dates" }, ...dates.map((item) => ({ value: item, label: dayLabel(new Date(`${item}T12:00:00`), today), count: upcoming.filter((fixture) => dateKey(new Date(fixture.kickoff_at)) === item).length }))];
  const visible = upcoming.filter((fixture) => (league === "all" || fixture.league === league) && (date === "all" || dateKey(new Date(fixture.kickoff_at)) === date));
  const groups = leagues.map((item) => ({ league: item, fixtures: visible.filter((fixture) => fixture.league === item) })).filter((group) => group.fixtures.length);
  const resetFilters = () => { setLeague("all"); setDate("all"); };

  return (
    <div className="matches-terminal-page">
      <section className="matches-head">
        <div className="matches-head-row">
          <div>
            <div className="matches-kickers"><span>SYS://MATCHES</span><span>FIFA WC 2026 + Top 5 Europe Leagues</span></div>
            <h1>Matches<span /></h1>
          </div>
          <SyncButton syncing={syncing} lastSync={lastSync} notice={syncNotice} cooldownSeconds={syncCooldownSeconds} onClick={handleSync} />
        </div>
        <p>Click a match to place your bet — the AI models predict the same fixture. Wager at least <b>30 minutes</b> before kickoff, once the Starting XI is confirmed.</p>
      </section>
      <Ticker rows={standings} />
      <div className="matches-filterbar">
        <Dropdown label="Competition" value={league} options={leagueOptions} onChange={setLeague} />
        <Dropdown label="Date · next 14 days" value={date} options={dateOptions} onChange={setDate} />
        {(league !== "all" || date !== "all") && <button type="button" className="matches-filter-reset" onClick={resetFilters}><RotateCcw size={12} />reset filters</button>}
        <span className="matches-filter-count">{visible.length} {visible.length === 1 ? "fixture" : "fixtures"} shown</span>
      </div>
      {loading ? <LoadingState /> : fixtures.length === 0 ? <EmptyState filtered={false} onReset={resetFilters} /> : visible.length === 0 ? <EmptyState filtered onReset={resetFilters} /> : (
        <main className="matches-board">
          {groups.map((group) => <section key={group.league}><LeagueDivider league={group.league} count={group.fixtures.length} /><div className="matches-grid">{group.fixtures.map((fixture) => <ScheduleCard key={fixture.id} fixture={fixture} placed={placed.has(fixture.id)} now={now} today={today} />)}</div></section>)}
        </main>
      )}
    </div>
  );
}
