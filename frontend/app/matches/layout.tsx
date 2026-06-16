import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Football Matches — AI Predictions & Odds",
  description:
    "Browse upcoming and past football matches with predictions from 5 AI models, live odds, and results.",
  alternates: { canonical: "/matches" },
};

export default function MatchesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
