import type { Metadata } from "next";
import { getAllFixtures, getPredictions, type Fixture } from "@/lib/api";
import HistoryClient from "./HistoryClient";

export const metadata: Metadata = {
  title: "Prediction History & Results",
  description:
    "Full track record of every AI model's football predictions — bets, odds, results and profit/loss over time.",
  alternates: { canonical: "/history" },
};

export default async function HistoryPage() {
  const [predictions, fixtures] = await Promise.all([getPredictions(), getAllFixtures()]);
  const fixtureMap = Object.fromEntries(fixtures.map((fixture: Fixture) => [fixture.id, fixture])) as Record<number, Fixture>;

  return (
    <div className="terminal-page history-terminal-page">
      <HistoryClient predictions={predictions} fixtureMap={fixtureMap} />
    </div>
  );
}
