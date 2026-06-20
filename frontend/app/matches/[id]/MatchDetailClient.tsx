"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { type FixtureWithPredictions, type Prediction } from "@/lib/api";
import { EXPECTED_PREDICTIONS_PER_FIXTURE, TOTAL_AI_PREDICTIONS_PER_MODE } from "@/lib/models";
import PredictionCard from "@/components/PredictionCard";
import PredictionsPoller from "@/components/PredictionsPoller";
import ManualOddsPanel from "@/components/ManualOddsPanel";
import UserBetForm from "@/components/UserBetForm";
import TeamLogo from "@/components/TeamLogo";
import MatchContextDebug from "@/components/MatchContextDebug";
import LineupsSection from "@/components/LineupPitch";
import LocalTime from "@/components/LocalTime";

const PER_MODE = TOTAL_AI_PREDICTIONS_PER_MODE;
const pickLabel: Record<string, string> = { home: "HOME", draw: "DRAW", away: "AWAY" };

function resultLabel(result: string | null) {
  if (result === "home") return "HOME WIN";
  if (result === "away") return "AWAY WIN";
  if (result === "draw") return "DRAW";
  return "RESULT PENDING";
}

function average(predictions: Prediction[], key: "home_prob" | "draw_prob" | "away_prob") {
  if (!predictions.length) return 0;
  return Math.round(predictions.reduce((sum, prediction) => sum + prediction[key] * 100, 0) / predictions.length);
}

function consensus(predictions: Prediction[]) {
  const counts = { home: 0, draw: 0, away: 0 };
  predictions.forEach((prediction) => { counts[prediction.bet_on] += 1; });
  const top = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "home") as keyof typeof counts;
  const minority = predictions.filter((prediction) => prediction.bet_on !== top).map((prediction) => prediction.model_name);
  return {
    counts,
    top: pickLabel[top],
    avgHome: average(predictions, "home_prob"),
    avgDraw: average(predictions, "draw_prob"),
    avgAway: average(predictions, "away_prob"),
    dissent: minority.length ? minority.join(" / ") : "NONE",
  };
}

function MatchHeaderCard({ fixture }: { fixture: FixtureWithPredictions }) {
  const finished = fixture.status === "finished";
  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-[18px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/matches" className="font-mono text-[11px] tracking-[0.08em] text-[var(--term-muted)] transition-colors hover:text-[var(--accent)]">
          &lt; MATCHES
        </Link>
        <span className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${finished ? "border-[var(--term-border-2)] text-[var(--term-muted)]" : "border-[rgba(255,180,84,.42)] text-[var(--term-amber)]"}`}>
          {finished ? `FULL TIME / ${resultLabel(fixture.result)}` : "KICKOFF PENDING"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="min-w-0 text-center">
          <TeamLogo src={fixture.home_team_crest} alt={fixture.home_team} className="mx-auto h-[54px] w-[54px]" />
          <div className="mt-2 truncate font-mono text-sm font-semibold text-[var(--term-text)]">{fixture.home_team}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--term-dim)]">HOME</div>
        </div>
        <div className="px-2 text-center">
          {finished ? (
            <span className="font-mono text-[30px] font-semibold leading-none text-white">
              {fixture.home_goals ?? 0}<span className="mx-2 text-[var(--term-dim)]">:</span>{fixture.away_goals ?? 0}
            </span>
          ) : (
            <span className="font-mono text-xl font-semibold tracking-[0.12em] text-[var(--term-amber)]">VS</span>
          )}
        </div>
        <div className="min-w-0 text-center">
          <TeamLogo src={fixture.away_team_crest} alt={fixture.away_team} className="mx-auto h-[54px] w-[54px]" />
          <div className="mt-2 truncate font-mono text-sm font-semibold text-[var(--term-text)]">{fixture.away_team}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--term-dim)]">AWAY</div>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--term-border)] pt-3 text-center">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">{fixture.league}</div>
        <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">
          <LocalTime iso={fixture.kickoff_at} options={{ weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }} />
        </div>
      </div>
    </section>
  );
}

function ConsensusStrip({ predictions, blind }: { predictions: Prediction[]; blind: boolean }) {
  const c = consensus(predictions);
  const segments = [
    ["HOME", c.avgHome, "var(--term-pos)"],
    ["DRAW", c.avgDraw, "var(--term-amber)"],
    ["AWAY", c.avgAway, "var(--term-neg)"],
  ] as const;

  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">AI CONSENSUS</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// {PER_MODE} {blind ? "BLIND " : ""}MODELS AGGREGATED</span>
        <span className="ml-auto border border-[rgba(56,209,124,.42)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-pos)]">LEAN / {c.top}</span>
      </div>

      <div className="mb-2 flex h-[10px] overflow-hidden border border-[var(--term-border)]">
        {segments.map(([label, value, color]) => (
          <div key={label} title={`${label} ${value}%`} style={{ width: `${value}%`, background: color, borderRight: "1px solid var(--term-bg)" }} />
        ))}
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        {segments.map(([label, value, color]) => (
          <span key={label} className="font-mono text-xs tabular-nums text-[var(--term-text)]">
            <span style={{ color }} className="text-[10px] uppercase tracking-[0.12em]">{label} </span>{value}%
          </span>
        ))}
      </div>
      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        SPLIT / {c.counts.home} HOME / {c.counts.draw} DRAW / {c.counts.away} AWAY
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        DISSENT / {c.dissent}
      </div>
    </section>
  );
}

function PredictionsLoadingPanel({ count, blind }: { count: number; blind: boolean }) {
  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-7 text-center">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
        <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-[var(--accent)]" />
        {blind ? "BLIND " : ""}MODELS COMPUTING PREDICTIONS...
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        // {count}/{PER_MODE} MODELS REPORTED
      </div>
      <div className="mx-auto mt-4 h-[5px] max-w-[320px] overflow-hidden border border-[var(--term-border)] bg-[var(--term-surface-2)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(8, (count / PER_MODE) * 100)}%` }} />
      </div>
    </section>
  );
}

function PredictionsWaitingStrip({ count }: { count: number }) {
  return (
    <section className="flex flex-wrap items-center gap-3 border border-[var(--term-border)] bg-[var(--term-surface)] px-4 py-3">
      <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full bg-[var(--accent)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
        {count}/{PER_MODE} MODELS REPORTED
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        // WAITING FOR SLOWER MODELS...
      </span>
      <div className="ml-auto h-[5px] w-[120px] overflow-hidden border border-[var(--term-border)] bg-[var(--term-surface-2)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${(count / PER_MODE) * 100}%` }} />
      </div>
    </section>
  );
}

function ModeToggle({ blind, onChange }: { blind: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={blind}
      aria-label="Fully decided by model"
      onClick={() => onChange(!blind)}
      className="ml-auto inline-flex cursor-pointer items-center gap-2 bg-transparent select-none"
    >
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-muted)]">Fully decided by model</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[18px] w-[34px] items-center border transition-colors ${blind ? "border-[rgba(56,209,124,.6)] bg-[rgba(56,209,124,.18)]" : "border-[var(--term-border-2)] bg-[var(--term-surface-2)]"}`}
      >
        <span
          className={`absolute top-[2px] h-[12px] w-[12px] transition-all ${blind ? "left-[18px] bg-[var(--term-pos)]" : "left-[2px] bg-[var(--term-dim)]"}`}
        />
      </span>
    </button>
  );
}

function BlindExplainer() {
  return (
    <section className="border border-[rgba(56,209,124,.32)] bg-[rgba(56,209,124,.06)] p-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-pos)]">BLIND MODE</div>
      <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-[var(--term-muted)]">
        Each model estimated win probabilities <strong className="text-[var(--term-text)]">without seeing the bookmaker odds</strong>. The
        odds were then applied afterward by deterministic code to identify the highest-EV bet and size the stake.
      </p>
    </section>
  );
}

// TEMPORARY: exact accounts allowed to use the manual-odds override (case-sensitive).
const MANUAL_ODDS_USERS = ["Alex", "alex_real", "Kim"];

export default function MatchDetailClient({ fixture }: { fixture: FixtureWithPredictions }) {
  const [blind, setBlind] = useState(false);
  const { user } = useAuth();
  const canManualOdds = !!user && MANUAL_ODDS_USERS.includes(user.username);

  // Originals and blind come from separate backend tables / response fields.
  const originalPredictions = fixture.predictions.filter((p) => p.model_name !== "sirkim");
  const blindPredictions = fixture.blind_predictions ?? [];
  const shown = blind ? blindPredictions : originalPredictions;

  // Poll until both modes have reported (10 total), so completed results show
  // progressively while slower models or the other mode are still computing.
  const totalDone = originalPredictions.length + blindPredictions.length;
  const allDone = totalDone >= EXPECTED_PREDICTIONS_PER_FIXTURE;
  const modeReady = shown.length >= PER_MODE;

  return (
    <div className="terminal-page min-h-screen" style={{ "--accent": "var(--term-pos)" } as CSSProperties}>
      {!allDone && <PredictionsPoller />}
      <div className="mx-auto max-w-[1280px] px-7 pb-20 pt-[18px] max-[760px]:px-3.5 max-[760px]:pb-[84px]">
        <div className="grid grid-cols-[360px_1fr] items-start gap-[18px] max-[960px]:grid-cols-1">
          <aside className="sticky top-[18px] grid gap-3.5 max-[960px]:static">
            <MatchHeaderCard fixture={fixture} />
            <UserBetForm
              fixtureId={fixture.id}
              homeTeam={fixture.home_team}
              awayTeam={fixture.away_team}
              homeTeamCrest={fixture.home_team_crest}
              awayTeamCrest={fixture.away_team_crest}
              kickoffAt={fixture.kickoff_at}
            />
            <ConsensusStrip predictions={shown} blind={blind} />
            {/* TEMPORARY: manual odds override — allow-listed accounts only. */}
            {fixture.status !== "finished" && canManualOdds && <ManualOddsPanel fixtureId={fixture.id} />}
          </aside>

          <main className="grid min-w-0 gap-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">AI PREDICTIONS</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">
                // {PER_MODE} {blind ? "BLIND " : ""}MODELS / TAP CARD FOR REASONING
              </span>
              <ModeToggle blind={blind} onChange={setBlind} />
            </div>

            {blind && <BlindExplainer />}

            {shown.length > 0 && (
              <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
                {shown.map((prediction) => (
                  <PredictionCard key={prediction.id} prediction={prediction} />
                ))}
              </div>
            )}
            {!modeReady &&
              (shown.length === 0 ? (
                <PredictionsLoadingPanel count={0} blind={blind} />
              ) : (
                <PredictionsWaitingStrip count={shown.length} />
              ))}

            <LineupsSection
              fixtureId={fixture.id}
              homeTeam={fixture.home_team}
              awayTeam={fixture.away_team}
              kickoffAt={fixture.kickoff_at}
            />

            {(originalPredictions.length > 0 || blindPredictions.length > 0) && (
              <MatchContextDebug predictions={originalPredictions} blindPredictions={blindPredictions} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
