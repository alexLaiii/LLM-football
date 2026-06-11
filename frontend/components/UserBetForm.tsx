"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMyBankroll,
  getMyBetForFixture,
  getOdds,
  placeUserBet,
  type Odds,
  type UserBet,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import TeamLogo from "@/components/TeamLogo";
import AuthModal from "@/components/AuthModal";

type Props = {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  homeTeamCrest: string | null;
  awayTeamCrest: string | null;
  kickoffAt: string;
};

const BET_OPTIONS: { value: "home" | "draw" | "away" }[] = [
  { value: "home" },
  { value: "draw" },
  { value: "away" },
];

const pickLabel: Record<"home" | "draw" | "away", string> = {
  home: "HOME",
  draw: "DRAW",
  away: "AWAY",
};

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function pickName(pick: "home" | "draw" | "away", homeTeam: string, awayTeam: string) {
  if (pick === "home") return homeTeam;
  if (pick === "away") return awayTeam;
  return "Draw";
}

function ResultBadge({ bet }: { bet: UserBet }) {
  if (bet.status === "won") {
    return <span className="inline-flex items-center border border-[rgba(56,209,124,.45)] bg-[rgba(56,209,124,.08)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-pos)]">WON {signedMoney(bet.profit_loss ?? 0)}</span>;
  }
  if (bet.status === "lost") {
    return <span className="inline-flex items-center border border-[rgba(255,89,112,.45)] bg-[rgba(255,89,112,.08)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-neg)]">LOST {signedMoney(bet.profit_loss ?? 0)}</span>;
  }
  if (bet.status === "void") {
    return <span className="inline-flex items-center border border-[rgba(154,167,183,.35)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-muted)]">VOID {signedMoney(bet.profit_loss ?? 0)}</span>;
  }
  return <span className="inline-flex items-center gap-2 border border-[rgba(255,180,84,.38)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--term-amber)]"><i className="h-[6px] w-[6px] rounded-full bg-[var(--term-cyan)]" />PENDING</span>;
}

function Header({ title, userName }: { title: string; userName?: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">{title}</span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// OPERATOR / {userName ?? "GUEST"}</span>
    </div>
  );
}

function BettingClosed({ userName }: { userName?: string }) {
  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
      <Header title="BETTING CLOSED" userName={userName} />
      <div className="py-4 text-center">
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">// MATCH HAS STARTED &mdash; WAGERS LOCKED</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--term-dim)]">No new positions can be opened after kickoff.</div>
      </div>
    </section>
  );
}

export default function UserBetForm({ fixtureId, homeTeam, awayTeam, homeTeamCrest, awayTeamCrest, kickoffAt }: Props) {
  const router = useRouter();
  const { user, token } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [betOn, setBetOn] = useState<"home" | "draw" | "away">("home");
  const [stake, setStake] = useState("");
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [existingBet, setExistingBet] = useState<UserBet | null>(null);
  const [odds, setOdds] = useState<Odds | null>(null);
  const [loadingOdds, setLoadingOdds] = useState(true);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(() => new Date(kickoffAt).getTime() <= Date.now());

  // Flip to "started" exactly at kickoff so the form locks even if the user
  // is sitting on the page when the match begins.
  useEffect(() => {
    if (started) return;
    const ms = new Date(kickoffAt).getTime() - Date.now();
    if (ms > 2_000_000_000) return; // too far out to schedule; re-checked on next mount
    const timer = setTimeout(() => setStarted(true), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [kickoffAt, started]);

  useEffect(() => {
    let ignore = false;
    setOdds(null);
    setLoadingOdds(true);
    getOdds(fixtureId).then((nextOdds) => {
      if (ignore) return;
      setOdds(nextOdds);
      setLoadingOdds(false);
    });
    return () => {
      ignore = true;
    };
  }, [fixtureId]);

  useEffect(() => {
    if (!token) {
      setLoadingExisting(false);
      return;
    }
    Promise.all([getMyBankroll(token), getMyBetForFixture(token, fixtureId)]).then(([b, bet]) => {
      setBankroll(b);
      setExistingBet(bet);
      setLoadingExisting(false);
    });
  }, [token, fixtureId]);

  const selectedOdds = odds ? odds[betOn] : null;
  const stakeNum = parseFloat(stake);
  const potentialPayout = selectedOdds && stakeNum > 0 ? stakeNum * selectedOdds : null;

  async function submitBet() {
    if (!token) return;
    if (started) {
      setError("Betting closed — the match has already started.");
      return;
    }
    if (!stakeNum || stakeNum <= 0) {
      setError("Enter a valid bet amount.");
      return;
    }
    if (loadingOdds || !selectedOdds) {
      setError("Odds are still loading.");
      return;
    }
    if (bankroll !== null && stakeNum > bankroll) {
      setError(`Stake exceeds available bankroll (${money(bankroll)}).`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const placed = await placeUserBet(token, fixtureId, betOn, stakeNum);
      setExistingBet(placed);
      const fresh = await getMyBankroll(token);
      setBankroll(fresh);
      setLoading(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error placing bet");
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitBet();
  }

  if (!user) {
    if (started) return <BettingClosed />;
    return (
      <>
        <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
          <Header title="PLACE WAGER" />
          <div className="py-4 text-center">
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">// AUTH REQUIRED TO PLACE A WAGER</div>
            <button type="button" onClick={() => setAuthOpen(true)} className="border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--term-bg)] shadow-[0_0_22px_-6px_var(--accent)]">
              SIGN IN TO BET &gt;
            </button>
            <div className="mt-3.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--term-dim)]">5 MODELS / LIVE ON THIS MATCH</div>
          </div>
        </section>
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--term-border-2)] bg-[rgba(17,22,30,.94)] px-6 py-3.5 backdrop-blur md:hidden">
          <button type="button" onClick={() => setAuthOpen(true)} className="w-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--term-bg)]">
            SIGN IN TO BET &gt;
          </button>
        </div>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onSuccess={() => router.refresh()} />
      </>
    );
  }

  if (loadingExisting) {
    return (
      <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
        <Header title="YOUR POSITION" userName={user.username} />
        <div className="font-mono text-sm text-[var(--term-muted)]">Loading position...</div>
      </section>
    );
  }

  if (existingBet) {
    const won = existingBet.status === "won";
    return (
      <>
        <section className={`border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px] ${won ? "shadow-[inset_0_0_0_1px_rgba(56,209,124,.3),0_0_28px_-14px_var(--term-pos)]" : ""}`}>
          <Header title="YOUR POSITION" userName={user.username} />
          <div className="flex flex-wrap items-end gap-[18px]">
            <div>
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">PICK</div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-[22px] font-semibold text-white">{pickName(existingBet.bet_on, homeTeam, awayTeam)}</span>
                <span className="border border-[rgba(56,209,124,.42)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-pos)]">{pickLabel[existingBet.bet_on]}</span>
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">ODDS</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-[var(--term-text)]">{existingBet.odds.toFixed(2)}</div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">STAKE</div>
              <div className="font-mono text-lg font-semibold tabular-nums text-[var(--term-text)]">{money(existingBet.stake)}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">{existingBet.profit_loss !== null ? "RESULT" : "STATUS"}</div>
              <ResultBadge bet={existingBet} />
            </div>
          </div>
          <div className="mt-4 flex justify-between gap-3 border-t border-[var(--term-border)] pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
            <span>POTENTIAL PAYOUT / <b className="font-semibold text-[var(--term-text)]">{money(existingBet.stake * existingBet.odds)}</b></span>
            {bankroll !== null && <span>BANKROLL / <b className="font-semibold text-[var(--term-text)]">{money(bankroll)}</b></span>}
          </div>
          <div className="mt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">// ONE WAGER PER MATCH / POSITION LOCKED</div>
        </section>
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-[var(--term-border-2)] bg-[rgba(17,22,30,.94)] px-6 py-3.5 backdrop-blur md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <TeamLogo src={existingBet.bet_on === "away" ? awayTeamCrest : homeTeamCrest} alt={pickName(existingBet.bet_on, homeTeam, awayTeam)} className="h-[30px] w-[30px]" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-muted)]">YOUR PICK</div>
              <div className="truncate font-mono text-[13px] font-semibold text-[var(--term-text)]">{pickLabel[existingBet.bet_on]} @ {existingBet.odds.toFixed(2)} <span className="text-[var(--term-dim)]">/ {money(existingBet.stake)}</span></div>
            </div>
          </div>
          <ResultBadge bet={existingBet} />
        </div>
      </>
    );
  }

  if (started) return <BettingClosed userName={user.username} />;

  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
      <Header title="PLACE WAGER" userName={user.username} />
      <form onSubmit={handleSubmit}>
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">SELECT OUTCOME</div>
        <div className="mb-4 grid grid-cols-3 gap-2">
          {BET_OPTIONS.map(({ value }) => {
            const crest = value === "home" ? homeTeamCrest : value === "away" ? awayTeamCrest : null;
            const label = pickName(value, homeTeam, awayTeam);
            const odd = odds ? odds[value] : null;
            const selected = betOn === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setBetOn(value)}
                className={`min-h-[72px] border px-2 py-2 text-center transition-colors ${selected ? "border-[var(--accent)] bg-[rgba(56,209,124,.12)] text-white" : "border-[var(--term-border-2)] bg-[var(--term-surface-2)] text-[var(--term-muted)] hover:border-[var(--accent)] hover:text-white"}`}
              >
                <TeamLogo src={crest} alt={label} className="mx-auto h-6 w-6" />
                <span className="mt-1 block truncate text-[11px]">{label}</span>
                <span className={`mt-1 block font-mono text-[15px] font-semibold tabular-nums ${selected ? "text-[var(--accent)]" : "text-[var(--term-muted)]"}`}>
                  {loadingOdds ? "FETCHING" : odd !== null ? odd.toFixed(2) : "--"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">STAKE</div>
        <div className="mb-2 flex items-center gap-2.5">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[var(--term-dim)]">$</span>
            <input
              type="number"
              min="1"
              step="any"
              value={stake}
              onChange={(event) => setStake(event.target.value)}
              placeholder="0.00"
              className="w-full border border-[var(--term-border-2)] bg-[var(--term-surface-2)] py-2.5 pl-7 pr-3 font-mono text-[15px] text-[var(--term-text)] outline-none placeholder:text-[var(--term-dim)] focus:border-[var(--accent)]"
            />
          </div>
          {[25, 50, 100].map((value) => (
            <button key={value} type="button" onClick={() => setStake(String(value))} className="border border-[var(--term-border-2)] bg-transparent px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--term-muted)] hover:border-[var(--accent)] hover:text-white">
              {value}
            </button>
          ))}
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-4 border-t border-[var(--term-border)] pt-3.5">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">POTENTIAL PAYOUT</div>
            <div className={`font-mono font-semibold tabular-nums text-[var(--term-pos)] ${loadingOdds ? "text-[13px]" : "text-[22px]"}`}>{loadingOdds ? "FETCHING ODDS" : potentialPayout !== null ? money(potentialPayout) : "$0.00"}</div>
          </div>
          <button type="submit" disabled={loading || loadingOdds || !stake} className="border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--term-bg)] shadow-[0_0_22px_-6px_var(--accent)] disabled:opacity-50">
            {loading ? "PLACING..." : loadingOdds ? "FETCHING ODDS..." : "CONFIRM WAGER >"}
          </button>
        </div>

        {bankroll !== null && (
          <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
            BANKROLL / <span className="text-[var(--term-text)]">{money(bankroll)}</span> / ONE WAGER PER MATCH
          </div>
        )}
        {error && <p className="mt-3 text-xs text-[var(--term-neg)]">{error}</p>}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--term-border-2)] bg-[rgba(17,22,30,.94)] px-6 py-3.5 backdrop-blur md:hidden">
          <button type="submit" disabled={loading || loadingOdds || !stake} className="w-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--term-bg)] disabled:opacity-50">
            {loading ? "PLACING..." : loadingOdds ? "FETCHING ODDS..." : "CONFIRM WAGER >"}
          </button>
        </div>
      </form>
    </section>
  );
}
