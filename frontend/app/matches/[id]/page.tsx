import { getFixture } from "@/lib/api";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import MatchDetailClient from "./MatchDetailClient";

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

  return <MatchDetailClient fixture={fixture} />;
}
