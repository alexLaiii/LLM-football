import { getAllFixtures, getPredictions, type Fixture } from "@/lib/api";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage() {
  const [predictions, fixtures] = await Promise.all([getPredictions(), getAllFixtures()]);
  const fixtureMap = Object.fromEntries(fixtures.map((fixture: Fixture) => [fixture.id, fixture])) as Record<number, Fixture>;

  return (
    <div className="terminal-page history-terminal-page">
      <HistoryClient predictions={predictions} fixtureMap={fixtureMap} />
    </div>
  );
}
