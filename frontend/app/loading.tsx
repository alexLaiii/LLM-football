import type { CSSProperties } from "react";
import RouteLoading from "@/components/RouteLoading";

export default function GlobalLoading() {
  return (
    <div className="terminal-page min-h-screen" style={{ "--accent": "var(--term-cyan)" } as CSSProperties}>
      <RouteLoading />
    </div>
  );
}
