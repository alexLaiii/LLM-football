"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// Backstop only — the poller normally stops as soon as predictions are ready
// (its parent loading panel unmounts). The cap must comfortably exceed the
// slowest model; reasoning models (Opus, DeepSeek-R1) plus cold starts can take
// well over the old 3-minute limit, which left the page stuck after they landed.
const MAX_POLL_MS = 600_000; // 10 minutes

export default function PredictionsPoller() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const startRef = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - startRef.current > MAX_POLL_MS) {
        clearInterval(id);
        return;
      }
      startTransition(() => router.refresh());
    }, 2000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
