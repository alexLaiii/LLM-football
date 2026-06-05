"use client";

import { useEffect, useState } from "react";

export type TeamTheme = { primary: string; secondary: string };

// Module-level cache — survives re-renders and remounts within a session.
const cache = new Map<string, TeamTheme>();

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/**
 * Picks the two most prominent colors from raw RGBA canvas pixels.
 *
 * We do this ourselves instead of using a library: `colorthief`'s quantizer
 * silently returns a constant fallback colour in the production bundle (its
 * worker path fails to load), which painted every card the same red even
 * though the pixels read back correctly. A plain histogram has no worker/wasm
 * dependency, so it behaves identically in dev and on the deployed site.
 *
 * Near-transparent, near-white and near-black pixels are skipped so the result
 * reflects the team's identity colour rather than crest backgrounds/outlines.
 */
function extractColors(data: Uint8ClampedArray): TeamTheme | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue; // transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 240 && min > 240) continue; // near-white
    if (max < 18) continue; // near-black
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); // 5 bits/channel
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return null;

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const avg = (bk: (typeof sorted)[number]) => toHex(bk.r / bk.count, bk.g / bk.count, bk.b / bk.count);
  return { primary: avg(sorted[0]), secondary: avg(sorted[1] ?? sorted[0]) };
}

/**
 * Extracts the two dominant colors from a team crest via the /api/crest-proxy
 * route (needed to satisfy CORS). Returns `initial` immediately and updates
 * to the real colors once the image has loaded and been analysed.
 */
export function useTeamColors(crestUrl: string | null, initial: TeamTheme): TeamTheme {
  const [colors, setColors] = useState<TeamTheme>(initial);

  // Reset to the initial fallback whenever the team changes.
  useEffect(() => {
    setColors(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crestUrl]);

  useEffect(() => {
    if (!crestUrl) return;

    const cached = cache.get(crestUrl);
    if (cached) {
      setColors(cached);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        // Load via a same-origin blob: URL so the canvas can never be tainted.
        const res = await fetch(`/api/crest-proxy?url=${encodeURIComponent(crestUrl)}`);
        if (!res.ok) throw new Error(`proxy responded ${res.status}`);
        objectUrl = URL.createObjectURL(await res.blob());

        const img = new Image();
        img.src = objectUrl;
        await img.decode();
        if (cancelled || !img.naturalWidth) return;

        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const theme = extractColors(data);
        if (!theme) return;
        cache.set(crestUrl, theme);
        setColors(theme);
      } catch (err) {
        console.warn("[crest-colors] extraction failed:", crestUrl, err);
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [crestUrl, initial]);

  return colors;
}
