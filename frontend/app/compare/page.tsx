"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Expand } from "lucide-react";
import { getCompare, type CompareData, type CompareEntry, type Prediction, type UserBet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import AuthModal from "@/components/AuthModal";
import ModelIcon, { modelIconSrc } from "@/components/ModelIcon";

const AI_MODELS = [
  { id: "claude", name: "Claude", subtitle: "Anthropic model", code: "CL", hue: "oklch(0.74 0.13 55)" },
  { id: "gpt5", name: "ChatGPT", subtitle: "OpenAI model", code: "GP", hue: "oklch(0.74 0.13 165)" },
  { id: "gemini", name: "Gemini", subtitle: "Google model", code: "GM", hue: "oklch(0.74 0.13 255)" },
  { id: "grok", name: "Grok", subtitle: "xAI model", code: "GK", hue: "oklch(0.74 0.13 305)" },
  { id: "deepseek", name: "DeepSeek", subtitle: "DeepSeek model", code: "DS", hue: "oklch(0.74 0.13 210)" },
];
const RESULT_LABEL: Record<string, string> = { home: "Home win", draw: "Draw", away: "Away win" };
const PAGE_SIZE = 15;
const LEAGUE_ICONS: Record<string, string> = {
  "Premier League": "/PL.png",
  "La Liga": "/LL.png",
  Bundesliga: "/BL.png",
  "Ligue 1": "/L1.png",
  "Serie A": "/SA.png",
  "UEFA Champions League": "/CL.png",
  "UEFA Europa League": "/EL.png",
  "World Cup": "/2026_FIFA_World_Cup_emblem.svg.webp",
};

type Filter = "all" | "won" | "lost" | "pending";
type Verdict = "won" | "lost" | "tied" | "pending";
type BettorStatus = "pending" | "won" | "lost" | "void";
type Bettor = {
  key: string;
  name: string;
  subtitle: string;
  code: string;
  isUser: boolean;
  hue: string;
  pick: string;
  odds: number | null;
  stake: number | null;
  pl: number | null;
  status: BettorStatus;
};
type VMatch = {
  id: number;
  home: string;
  away: string;
  league: string;
  date: string;
  settled: boolean;
  finalResult: string | null;
  userPL: number | null;
  aiAvgPL: number | null;
  verdict: Verdict;
  bettors: Bettor[];
};

const VERDICT_META: Record<Verdict, { label: string; fg: string }> = {
  won: { label: "YOU WIN", fg: "var(--term-pos)" },
  lost: { label: "AI WIN", fg: "var(--term-neg)" },
  tied: { label: "DRAW", fg: "var(--term-amber)" },
  pending: { label: "PENDING", fg: "var(--term-dim)" },
};

const cn = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");
const plColor = (value: number | null) => value === null ? "var(--term-dim)" : value > 0 ? "var(--term-pos)" : value < 0 ? "var(--term-neg)" : "var(--term-muted)";
const verdictStyle = (verdict: Verdict) => ({ "--vfg": VERDICT_META[verdict].fg } as CSSProperties);

function fmtSignedMoney(value: number | null) {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMoney(value: number | null) {
  if (value === null) return "-";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

function fmtRate(value: number) {
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function pickLabel(pick: "home" | "draw" | "away" | null) {
  if (pick === "home") return "HOME";
  if (pick === "away") return "AWAY";
  if (pick === "draw") return "DRAW";
  return "PENDING";
}

function toBettor(source: UserBet | Prediction | null, fallback: Omit<Bettor, "pick" | "odds" | "stake" | "pl" | "status">): Bettor {
  return {
    ...fallback,
    pick: source ? pickLabel(source.bet_on) : "PENDING",
    odds: source?.odds ?? null,
    stake: source?.stake ?? null,
    pl: source?.profit_loss ?? null,
    status: (source?.status ?? "pending") as BettorStatus,
  };
}

function toMatch(entry: CompareEntry): VMatch {
  const byModel = new Map(entry.ai_predictions.map((prediction) => [prediction.model_name, prediction]));
  const user = toBettor(entry.user_bet, {
    key: "you",
    name: "You",
    subtitle: "solo on the board",
    code: "YOU",
    isUser: true,
    hue: "var(--term-cyan)",
  });
  const aiBettors = AI_MODELS.map((model) =>
    toBettor(byModel.get(model.id) ?? null, {
      key: model.id,
      name: model.name,
      subtitle: model.subtitle,
      code: model.code,
      isUser: false,
      hue: model.hue,
    }),
  );
  const settledAi = aiBettors.map((bettor) => bettor.pl).filter((value): value is number => value !== null);
  const aiAvgPL = settledAi.length ? settledAi.reduce((sum, value) => sum + value, 0) / AI_MODELS.length : null;
  const userPL = user.pl;

  let verdict: Verdict = "pending";
  if (userPL !== null && aiAvgPL !== null) {
    if (Math.abs(userPL - aiAvgPL) <= 0.005) verdict = "tied";
    else verdict = userPL > aiAvgPL ? "won" : "lost";
  }

  return {
    id: entry.fixture_id,
    home: entry.home_team,
    away: entry.away_team,
    league: entry.league,
    date: fmtDate(entry.kickoff_at),
    settled: entry.result !== null,
    finalResult: entry.result ? RESULT_LABEL[entry.result] ?? entry.result : null,
    userPL,
    aiAvgPL,
    verdict,
    bettors: [user, ...aiBettors],
  };
}

function aiConsensus(match: VMatch) {
  const counts: Record<string, number> = {};
  match.bettors.filter((bettor) => !bettor.isUser).forEach((bettor) => {
    counts[bettor.pick] = (counts[bettor.pick] ?? 0) + 1;
  });
  let pick = "PENDING";
  let n = -1;
  Object.entries(counts).forEach(([candidate, count]) => {
    if (count > n) {
      pick = candidate;
      n = count;
    }
  });
  return { pick, n: Math.max(n, 0), total: AI_MODELS.length };
}

function MonoLabel({ children, dot, color, className }: { children: ReactNode; dot: string; color: string; className?: string }) {
  return (
    <span className={cn("compare-mono-label", className)} style={{ color }}>
      <span style={{ background: dot }} />
      {children}
    </span>
  );
}

function PL({ value, pending, size }: { value: number | null; pending?: boolean; size?: number }) {
  return (
    <span className="compare-pl mono-num" style={{ color: pending || value === null ? "var(--term-dim)" : plColor(value), fontSize: size }}>
      {pending || value === null ? "-" : fmtSignedMoney(value)}
    </span>
  );
}

function PickChip({ pick, win, settled }: { pick: string; win?: boolean; settled?: boolean }) {
  return <span className={cn("compare-pick-chip", settled && (win ? "is-win" : "is-loss"))}>{pick}</span>;
}

function StatusChip({ status }: { status: BettorStatus }) {
  return <span className={cn("compare-status-chip", `is-${status}`)}>{status.toUpperCase()}</span>;
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className="compare-verdict-badge" style={verdictStyle(verdict)}>
      {meta.label}
    </span>
  );
}

function LeagueIcon({ league, verdict }: { league: string; verdict: Verdict }) {
  const src = LEAGUE_ICONS[league];
  return (
    <span className="compare-league-icon" style={verdictStyle(verdict)} title={league}>
      {src ? <img src={src} alt={league} /> : league.slice(0, 2).toUpperCase()}
    </span>
  );
}

function CodeBox({ bettor }: { bettor: Bettor }) {
  const icon = !bettor.isUser ? modelIconSrc(bettor.key) : null;
  return (
    <span
      className={cn("compare-codebox", bettor.isUser && "is-you")}
      style={!bettor.isUser ? { color: bettor.hue, borderColor: bettor.hue } : undefined}
    >
      {icon ? <ModelIcon model={bettor.key} label={bettor.name} className="h-[70%] w-[70%] object-contain" /> : bettor.code}
    </span>
  );
}

function PageHead({ username, matchesBet }: { username: string; matchesBet: number }) {
  return (
    <header className="compare-page-head">
      <div className="compare-head-tags">
        <span>SYS://COMPARE</span>
        <span>FIFA WC 2026 + Top 5 Europe Leagues</span>
      </div>
      <h1>Compare Me to AI<span /></h1>
      <p>
        Your bet result compare to LLM.
      </p>
    </header>
  );
}

function DuelSummary({ summary, matches, username }: { summary: CompareData["summary"]; matches: VMatch[]; username: string }) {
  const youWins = matches.filter((match) => match.verdict === "won").length;
  const aiWins = matches.filter((match) => match.verdict === "lost").length;
  const ties = matches.filter((match) => match.verdict === "tied").length;
  return (
    <section className="compare-duel-summary">
      <div className="compare-duel-side is-you">
        <MonoLabel dot="var(--term-cyan)" color="var(--term-cyan)">IN THIS CORNER</MonoLabel>
        <div className="compare-duel-name">{username}</div>
        <div className="compare-duel-tag">you / solo on the board</div>
        <div className="compare-duel-pl mono-num" style={{ color: plColor(summary.user_pl) }}>{fmtSignedMoney(summary.user_pl)}</div>
        <div className="compare-duel-pl-label">YOUR NET P/L</div>
        <div className="compare-duel-rate"><b>{fmtRate(summary.user_win_rate)}</b><span>win rate</span></div>
      </div>
      <div className="compare-duel-center">
        <div className="compare-duel-record mono-num"><span>{youWins}</span><i>-</i><b>{aiWins}</b></div>
        <div className="compare-duel-record-label">HEAD-TO-HEAD{ties ? ` / ${ties} drawn` : ""}</div>
        <div className="compare-duel-vs">VS</div>
        <div className="compare-duel-matches">{summary.matches_bet} matches contested</div>
      </div>
      <div className="compare-duel-side is-ai">
        <MonoLabel dot="var(--term-neg)" color="var(--term-neg)" className="is-right">IN THAT CORNER</MonoLabel>
        <div className="compare-duel-name">The Machines</div>
        <div className="mt-2 flex justify-end gap-2">
          {AI_MODELS.map((model) => (
            <span key={model.id} className="grid h-7 w-7 place-items-center border bg-[var(--term-surface-2)] p-1" style={{ borderColor: model.hue }}>
              <ModelIcon model={model.id} label={model.name} className="h-full w-full object-contain" />
            </span>
          ))}
        </div>
        <div className="compare-duel-tag">five model average</div>
        <div className="compare-duel-pl mono-num" style={{ color: plColor(summary.ai_pl) }}>{fmtSignedMoney(summary.ai_pl)}</div>
        <div className="compare-duel-pl-label">AVG AI NET P/L</div>
        <div className="compare-duel-rate is-right"><b>{fmtRate(summary.ai_win_rate)}</b><span>win rate</span></div>
      </div>
    </section>
  );
}

function FilterBar({
  filter,
  counts,
  expandedAll,
  onFilter,
  onToggleAll,
}: {
  filter: Filter;
  counts: Record<Filter, number>;
  expandedAll: boolean;
  onFilter: (filter: Filter) => void;
  onToggleAll: () => void;
}) {
  const labels: Record<Filter, string> = { all: "ALL", won: "YOU WON", lost: "AI WON", pending: "PENDING" };
  return (
    <div className="compare-filterbar">
      <div className="compare-filters">
        {(["all", "won", "lost", "pending"] as Filter[]).map((item) => (
          <button key={item} type="button" className={cn(filter === item && "is-on")} onClick={() => onFilter(item)}>
            {labels[item]}<span>{counts[item]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="compare-ghost-action" onClick={onToggleAll}>
        <Expand size={13} />{expandedAll ? "COLLAPSE ALL" : "EXPAND ALL"}
      </button>
    </div>
  );
}

function BettorTable({ match }: { match: VMatch }) {
  return (
    <div className="compare-tally">
      <div className="compare-tally-head">
        <span>BETTOR</span><span>PICK</span><span>ODDS</span><span>STAKE</span><span>P/L</span><span>STATUS</span>
      </div>
      {match.bettors.map((bettor) => (
        <div key={bettor.key} className={cn("compare-tally-row", bettor.isUser && "is-you")}>
          <div className="compare-tb-bettor">
            <CodeBox bettor={bettor} />
            <div>
              <strong>{bettor.name}{bettor.isUser && <span>YOU</span>}</strong>
              <small>{bettor.subtitle}</small>
            </div>
          </div>
          <div className="compare-tb-pick"><PickChip pick={bettor.pick} win={match.settled && bettor.status === "won"} settled={match.settled} /></div>
          <div className="compare-ta-r mono-num">{bettor.odds === null ? "-" : bettor.odds.toFixed(2)}</div>
          <div className="compare-ta-r mono-num is-dim">{fmtMoney(bettor.stake)}</div>
          <div className="compare-ta-r"><PL value={bettor.pl} pending={!match.settled} /></div>
          <div className="compare-ta-r"><StatusChip status={bettor.status} /></div>
        </div>
      ))}
    </div>
  );
}

function MatchCardB({ match, open, onToggle }: { match: VMatch; open: boolean; onToggle: () => void }) {
  const user = match.bettors[0];
  const ai = aiConsensus(match);
  return (
    <section className={cn("compare-card", open && "is-open")} style={verdictStyle(match.verdict)}>
      <button type="button" className="compare-card-head" onClick={onToggle} aria-expanded={open}>
        <div className="compare-card-left">
          <LeagueIcon league={match.league} verdict={match.verdict} />
          <div className="compare-fixture">
            <div>{match.home} <span>vs</span> {match.away}</div>
            <small>
              {match.league}<i>/</i>{match.date}
              {match.settled && match.finalResult && <><i>/</i><b>{match.finalResult}</b></>}
            </small>
          </div>
        </div>
        <div className="compare-card-duel">
          <div className="compare-picks-side is-you">
            <small>YOUR CALL</small>
            <PickChip pick={user.pick} win={match.settled && user.status === "won"} settled={match.settled} />
            <PL value={match.userPL} pending={!match.settled} size={14} />
          </div>
          <div className="compare-picks-mid"><VerdictBadge verdict={match.verdict} /></div>
          <div className="compare-picks-side">
            <small>AI CONSENSUS</small>
            <span className="compare-pick-chip is-ai">{ai.pick}<em>{ai.n}/{ai.total}</em></span>
            <PL value={match.aiAvgPL} pending={!match.settled} size={14} />
          </div>
        </div>
        <ChevronDown className="compare-chevron" size={18} aria-hidden="true" />
      </button>
      {open && <div className="compare-card-body"><BettorTable match={match} /></div>}
    </section>
  );
}

function LoggedOut({ onSignIn, onCreate }: { onSignIn: () => void; onCreate: () => void }) {
  return (
    <div className="compare-gate">
      <h2>Sign in to compare</h2>
      <p>Compare Me to AI lines your own bets up against all five machines - same matches, same odds. Sign in to load your card and see how your P/L stacks up.</p>
      <div>
        <button type="button" className="compare-btn is-primary" onClick={onSignIn}>SIGN IN</button>
        <button type="button" className="compare-btn" onClick={onCreate}>CREATE ACCOUNT</button>
      </div>
    </div>
  );
}

function EmptyState({ onBet }: { onBet: () => void }) {
  return (
    <div className="compare-gate">
      <small>[ NO WAGERS ON FILE ]</small>
      <h2>You haven&apos;t bet yet</h2>
      <p>Once you place a bet on the board, it&apos;ll appear here side-by-side with the machines&apos; picks on the same match. Head to Matches to lay down your first call.</p>
      <button type="button" className="compare-btn is-primary" onClick={onBet}>BROWSE MATCHES</button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="terminal-loading compare-loading">
      <div className="terminal-loading-status">
        <span>LOADING COMPARE LEDGER</span>
        <div className="terminal-loading-progress"><span /></div>
      </div>
      {Array.from({ length: 5 }).map((_, index) => <div key={index} className="terminal-skeleton-row"><span /><span className="is-avatar" /><span /><span /><span /><span /></div>)}
    </div>
  );
}

export default function ComparePage() {
  const { user, token, loading: authLoading } = useAuth();
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<number | null>(null);
  const [expandedAll, setExpandedAll] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getCompare(token).then((result) => {
      setData(result);
      setLoading(false);
      setVisibleCount(PAGE_SIZE);
      setOpenId(null);
      setExpandedAll(false);
    });
  }, [token]);

  const matches = useMemo(() => (data ? data.entries.map(toMatch) : []), [data]);
  const counts = useMemo(
    () => ({
      all: matches.length,
      won: matches.filter((match) => match.verdict === "won").length,
      lost: matches.filter((match) => match.verdict === "lost").length,
      pending: matches.filter((match) => match.verdict === "pending").length,
    }),
    [matches],
  );
  const filtered = matches.filter((match) => filter === "all" || match.verdict === filter);
  const shown = filtered.slice(0, visibleCount);
  const remaining = Math.max(0, filtered.length - visibleCount);
  const username = user?.username ?? "You";

  function openAuth(mode: "login" | "register") {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function setActiveFilter(next: Filter) {
    setFilter(next);
    setVisibleCount(PAGE_SIZE);
    setOpenId(null);
    setExpandedAll(false);
  }

  let body: ReactNode;
  if (authLoading) {
    body = <LoadingState />;
  } else if (!user) {
    body = (
      <>
        <PageHead username="you" matchesBet={0} />
        <LoggedOut onSignIn={() => openAuth("login")} onCreate={() => openAuth("register")} />
      </>
    );
  } else if (loading) {
    body = (
      <>
        <PageHead username={username} matchesBet={0} />
        <LoadingState />
      </>
    );
  } else if (!data || matches.length === 0) {
    body = (
      <>
        <PageHead username={username} matchesBet={0} />
        <EmptyState onBet={() => router.push("/matches")} />
      </>
    );
  } else {
    body = (
      <>
        <PageHead username={username} matchesBet={data.summary.matches_bet} />
        <DuelSummary summary={data.summary} matches={matches} username={username} />
        <FilterBar
          filter={filter}
          counts={counts}
          expandedAll={expandedAll}
          onFilter={setActiveFilter}
          onToggleAll={() => {
            setExpandedAll((current) => !current);
            setOpenId(null);
          }}
        />
        <div className="compare-cardlist">
          {shown.map((match) => (
            <MatchCardB
              key={match.id}
              match={match}
              open={expandedAll || openId === match.id}
              onToggle={() => {
                setExpandedAll(false);
                setOpenId(openId === match.id ? null : match.id);
              }}
            />
          ))}
        </div>
        {remaining > 0 && (
          <div className="compare-loadmore-wrap">
            <button type="button" className="compare-loadmore" onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length))}>
              LOAD MORE / <span>{remaining} remaining</span>
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="terminal-page compare-terminal-page">
      <main className="compare-main">
        <div className="compare-content-inner">{body}</div>
      </main>
      <AuthModal key={authMode} open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} onSuccess={() => router.refresh()} />
    </div>
  );
}
