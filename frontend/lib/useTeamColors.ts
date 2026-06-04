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
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const dominant = getColorSync(img);
        const palette = getPaletteSync(img, { colorCount: 3 });
        const primary = dominant?.hex() ?? initial.primary;
        const secondary = palette?.[1]?.hex() ?? palette?.[0]?.hex() ?? primary;
        const theme: TeamTheme = { primary, secondary };
        cache.set(crestUrl, theme);
        if (!cancelled) setColors(theme);
      } catch {
        // Keep the initial fallback — don't throw.
      }
    };

    img.src = `/api/crest-proxy?url=${encodeURIComponent(crestUrl)}`;

    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [crestUrl, initial]);

  return colors;
}
