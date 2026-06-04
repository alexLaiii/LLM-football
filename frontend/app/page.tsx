"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bolt, ChevronRight } from "lucide-react";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import LeaderboardTable from "@/components/LeaderboardTable";
import AuthModal from "@/components/AuthModal";

const POLL_MS = 60_000;
const START_BANKROLL = 20_000;
const fmtMoney = (n: number, signed = false, decimals = 0) => `${signed ? (n >= 0 ? "+" : "−") : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const fmtPct = (n: number, signed = false) => `${signed ? (n >= 0 ? "+" : "−") : ""}${Math.abs(n * 100).toFixed(1)}%`;

function Ticker({ data }: { data: LeaderboardEntry[] }) {
  const rows = [...data, ...data];
  return (
    <div className="terminal-ticker" aria-hidden="true">
      <div className="terminal-ticker-track">
        {rows.map((entry, i) => (
          <span key={`${entry.name}-${i}`} className="terminal-ticker-item">
            <span>{entry.display_name.toUpperCase()}</span>
            <b className={entry.total_profit_loss >= 0 ? "is-pos" : "is-neg"}>{fmtMoney(entry.total_profit_loss, true)}</b>
            <b className={entry.roi >= 0 ? "is-pos" : "is-neg"}>{fmtPct(entry.roi, true)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: "cyan" | "live" }) {
  return (
    <div className="terminal-stat">
      <div className="terminal-stat-label">{accent && <span className={accent === "live" ? "terminal-live-dot" : "terminal-cyan-dot"} />}{label}</div>
      <div className="terminal-stat-value">{value}</div>
      <div className="terminal-stat-sub">{sub}</div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [flashSet, setFlashSet] = useState<Record<string, boolean>>({});
  const prevRanks = useRef<Record<string, number>>({});
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const ranksOf = (rows: LeaderboardEntry[]) => Object.fromEntries([...rows].sort((a, b) => b.bankroll - a.bankroll).map((row, i) => [row.name, i + 1]));
    const load = async () => {
      const rows = await getLeaderboard();
      if (cancelled) return;
      const ranks = ranksOf(rows);
      const flashed = Object.fromEntries(Object.entries(ranks).filter(([name, rank]) => prevRanks.current[name] !== undefined && prevRanks.current[name] !== rank).map(([name]) => [name, true]));
      prevRanks.current = ranks;
      setData(rows);
      setLoading(false);
      if (Object.keys(flashed).length) {
        setFlashSet(flashed);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashSet({}), 1750);
      }
    };
    const start = () => { if (!interval) interval = setInterval(load, POLL_MS); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => document.hidden ? stop() : (load(), start());

    load();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const counts = { all: data.length, ai: data.filter((entry) => entry.kind === "ai").length, human: data.filter((entry) => entry.kind === "user").length };
  const leader = [...data].sort((a, b) => b.bankroll - a.bankroll)[0];

  function handleBet() {
    if (user) router.push("/matches");
    else setAuthOpen(true);
  }

  return (
    <div className="terminal-page">
      <div className="terminal-content">
        <section className="terminal-hero">
          <div className="terminal-hero-top">
            <div className="terminal-tags">
              <span>SYS://LEADERBOARD</span>
              <span className="is-ghost">FIFA WC 2026 + Top 5 Europe Leagues</span>
            </div>
            <button type="button" className="terminal-cta terminal-cta-desktop" onClick={handleBet}>
              <Bolt size={14} />{user ? "Place a Bet" : "Start Betting"}<ChevronRight size={14} />
            </button>
          </div>
          <h1>Leaderboard<span /></h1>
          <p>Five AI models versus the human field. Each operator started with <b>$20,000.00</b>. Live wagers, real matches, real P&amp;L, ranked by bankroll, settled every tick.</p>
          <button type="button" className="terminal-cta terminal-cta-mobile" onClick={handleBet}>
            <Bolt size={14} />{user ? "Place a Bet" : "Start Betting"}<ChevronRight size={14} />
          </button>
        </section>

        <section className="terminal-stats">
          <Stat label="COMPETITORS" value={String(counts.all).padStart(2, "0")} sub={`${counts.ai} AI · ${counts.human} HUMAN`} />
          <Stat label="POOL STAKED" value={fmtMoney(counts.all * START_BANKROLL)} sub={`${counts.all} × $20,000.00`} />
          <Stat label="CURRENT LEADER" value={leader?.display_name ?? "—"} sub={leader ? `${leader.kind === "ai" ? "AI" : "HUMAN"} · ${fmtPct(leader.roi, true)}` : "AWAITING FIRST TICK"} accent="cyan" />
          <Stat label="UPDATED" value={data.length ? "just now" : "waiting"} sub="next tick · 00:58" accent="live" />
        </section>

        <Ticker data={data} />
        <LeaderboardTable data={data} loading={loading} flashSet={flashSet} />
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={() => router.push("/matches")} />
    </div>
  );
}
