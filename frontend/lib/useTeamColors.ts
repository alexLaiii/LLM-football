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
    img.src = `/api/crest-proxy?url=${encodeURIComponent(crestUrl)}`;

    // `decode()` resolves only once the bitmap is actually decoded — unlike
    // `onload`, which can fire before the pixels are ready. Reading colours
    // off an undecoded image yields colorthief's default colour every time
    // (the "all cards same red" bug seen on slower production networks).
    img.decode().then(() => {
      if (cancelled || !img.naturalWidth) return;
      try {
        const dominant = getColorSync(img);
        const palette = getPaletteSync(img, { colorCount: 3 });
        const primary = dominant?.hex() ?? initial.primary;
        const secondary = palette?.[1]?.hex() ?? palette?.[0]?.hex() ?? primary;
        const theme: TeamTheme = { primary, secondary };
        cache.set(crestUrl, theme);
        setColors(theme);
      } catch (err) {
        console.warn("[crest-colors] extraction failed:", crestUrl, err);
      }
    }).catch((err) => {
      console.warn("[crest-colors] decode failed:", crestUrl, err);
    });

    return () => {
      cancelled = true;
    };
  }, [crestUrl, initial]);

  return colors;
}
