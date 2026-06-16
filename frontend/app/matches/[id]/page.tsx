import { getFixture, type FixtureWithPredictions, type Prediction } from "@/lib/api";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import PredictionCard from "@/components/PredictionCard";
import PredictionsPoller from "@/components/PredictionsPoller";
import UserBetForm from "@/components/UserBetForm";
import TeamLogo from "@/components/TeamLogo";
import MatchContextDebug from "@/components/MatchContextDebug";
import LineupsSection from "@/components/LineupPitch";
import Link from "next/link";
import LocalTime from "@/components/LocalTime";

const TOTAL_AI_PREDICTIONS = 5;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const fixture = await getFixture(parseInt(id));
  if (!fixture) return { title: "Match not found" };

  const matchup = `${fixture.home_team} vs ${fixture.away_team}`;
  const title = `${matchup} — AI Predictions & Odds`;
  const description =
    fixture.status === "finished"
      ? `How 5 AI models predicted ${matchup} (${fixture.league}) — each model's pick, probabilities, odds and the final result.`
      : `5 AI models predict ${matchup} (${fixture.league}). Compare every model's pick, win probabilities, odds and reasoning.`;
  const path = `/matches/${fixture.id}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: `${title} | LLM Bets`, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

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

function ConsensusStrip({ predictions }: { predictions: Prediction[] }) {
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
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">// 5 MODELS AGGREGATED</span>
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

function PredictionsLoadingPanel({ count }: { count: number }) {
  return (
    <section className="border border-[var(--term-border)] bg-[var(--term-surface)] p-7 text-center">
      <PredictionsPoller />
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
        <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-[var(--accent)]" />
        MODELS COMPUTING PREDICTIONS...
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        // POLLING EVERY 60s / {count}/{TOTAL_AI_PREDICTIONS} MODELS REPORTED
      </div>
      <div className="mx-auto mt-4 h-[5px] max-w-[320px] overflow-hidden border border-[var(--term-border)] bg-[var(--term-surface-2)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(8, (count / TOTAL_AI_PREDICTIONS) * 100)}%` }} />
      </div>
    </section>
  );
}

function PredictionsWaitingStrip({ count }: { count: number }) {
  return (
    <section className="flex flex-wrap items-center gap-3 border border-[var(--term-border)] bg-[var(--term-surface)] px-4 py-3">
      <PredictionsPoller />
      <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full bg-[var(--accent)]" />
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">
        {count}/{TOTAL_AI_PREDICTIONS} MODELS REPORTED
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--term-dim)]">
        // WAITING FOR SLOWER MODELS...
      </span>
      <div className="ml-auto h-[5px] w-[120px] overflow-hidden border border-[var(--term-border)] bg-[var(--term-surface-2)]">
        <div className="h-full bg-[var(--accent)]" style={{ width: `${(count / TOTAL_AI_PREDICTIONS) * 100}%` }} />
      </div>
    </section>
  );
}

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixture = await getFixture(parseInt(id));

  if (!fixture) {
    return (
      <div className="terminal-page min-h-screen" style={{ "--accent": "var(--term-pos)" } as CSSProperties}>
        <div className="terminal-content py-16">
          <div className="border border-dashed border-[var(--term-border-2)] p-12 text-center">
            <h1 className="text-2xl font-semibold text-white">Fixture not found</h1>
            <Link href="/matches" className="mt-4 inline-block font-mono text-sm uppercase tracking-[0.1em] text-[var(--accent)]">
              Back to matches
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const aiPredictions = fixture.predictions.filter((p) => p.model_name !== "sirkim");
  const allReady = aiPredictions.length >= TOTAL_AI_PREDICTIONS;

  return (
    <div className="terminal-page min-h-screen" style={{ "--accent": "var(--term-pos)" } as CSSProperties}>
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
            <ConsensusStrip predictions={aiPredictions} />
          </aside>

          <main className="grid min-w-0 gap-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--accent)]">AI PREDICTIONS</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--term-dim)]">
                // {TOTAL_AI_PREDICTIONS} MODELS / TAP CARD FOR REASONING
              </span>
            </div>

            {aiPredictions.length > 0 && (
              <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
                {aiPredictions.map((prediction) => (
                  <PredictionCard key={prediction.id} prediction={prediction} />
                ))}
              </div>
            )}
            {!allReady &&
              (aiPredictions.length === 0 ? (
                <PredictionsLoadingPanel count={0} />
              ) : (
                <PredictionsWaitingStrip count={aiPredictions.length} />
              ))}

            <LineupsSection
              fixtureId={fixture.id}
              homeTeam={fixture.home_team}
              awayTeam={fixture.away_team}
              kickoffAt={fixture.kickoff_at}
            />

            {aiPredictions.length > 0 && (
              <MatchContextDebug predictions={aiPredictions} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
