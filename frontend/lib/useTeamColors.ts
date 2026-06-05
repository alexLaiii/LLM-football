"use client";

import { useEffect, useState } from "react";
import { getColorSync, getPaletteSync } from "colorthief";

export type TeamTheme = { primary: string; secondary: string };

// Module-level cache — survives re-renders and remounts within a session.
const cache = new Map<string, TeamTheme>();

/**
 * Extracts the two dominant colors from a team crest via the /api/crest-proxy
 * route (needed to satisfy CORS). Returns `initial` immediately and updates
 * to the real colors once the image has loaded and been analysed.
 */
export function useTeamColors(
  crestUrl: string | null,
  initial: TeamTheme
): TeamTheme {
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
        // Fetch the proxied crest as a blob and load it through a same-origin
        // `blob:` URL. A crossOrigin <img> can be served from the CDN disk
        // cache without its CORS header, which taints the canvas — colorthief
        // then swallows the security error and returns a constant default
        // colour, painting every card the same red. A blob: URL is always
        // same-origin, so the canvas can never taint.
        const res = await fetch(`/api/crest-proxy?url=${encodeURIComponent(crestUrl)}`);
        if (!res.ok) throw new Error(`proxy responded ${res.status}`);
        objectUrl = URL.createObjectURL(await res.blob());

        const img = new Image();
        img.src = objectUrl;
        await img.decode();
        if (cancelled || !img.naturalWidth) return;

        const dominant = getColorSync(img);
        const palette = getPaletteSync(img, { colorCount: 3 });
        const primary = dominant?.hex() ?? initial.primary;
        const secondary = palette?.[1]?.hex() ?? palette?.[0]?.hex() ?? primary;
        const theme: TeamTheme = { primary, secondary };
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
