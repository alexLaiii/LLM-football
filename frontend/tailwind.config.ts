import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wc: {
          navy:   "#ffffff",
          card:   "#ffffff",
          border: "#e5e7eb",
          red:    "#dc2626",
          gold:   "#059669",
          muted:  "#64748b",
          blue:   "#f1f5f9",
          ink:    "#0f172a",
          subtle: "#f8fafc",
        },
        claude:      "#7c3aed",
        gpt5:        "#16a34a",
        gemini:      "#2563eb",
        grok:        "#ea580c",
        sirkim:      "#ca8a04",
        deepseek:    "#0891b2",

        // Sportsbook leaderboard palette ("Pro Terminal" design)
        ink:        "#1A1712",
        sub:        "#6B655B",
        faint:      "#9A938688",
        surface:    "#FFFFFF",
        subtle:     "#FAF8F3",
        wash:       "#F4F0E8",
        line:       "#ECE6DA",
        linestrong: "#DDD5C5",
        gold:       "#B5831E",
        goldink:    "#7C5A12",
        goldsoft:   "#FBF2DD",
        goldline:   "#E9D6A8",
        pos:        "#157F52",
        possoft:    "#E7F2EC",
        neg:        "#B23A2E",
        negsoft:    "#F7EBE8",

        // Frontier / Wanted-Poster matches board ("The Bill")
        ink2:       "#3A2C1C",
        paper:      "#F3E9D3",
        paper2:     "#ECE0C4",
        aged:       "#E6D7B2",
        creamlt:    "#FBF5E6",
        wood:       "#C79A5B",
        brass:      "#9A6B1F",
        brassink:   "#664410",
        brasslt:    "#C9A24E",
        brasssoft:  "#F2E4C0",
        barn:       "#8C2D1B",
        barnink:    "#5C1B0E",
        barnsoft:   "#F0DAC9",
        lineink:    "#7A6238",
      },
      fontFamily: {
        sans:    ["Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", "monospace"],
        archivo: ["Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        arvo: ["Arvo", "ui-serif", "Georgia", "serif"],
        jbmono:  ['"JetBrains Mono"', "ui-monospace", "monospace"],
        merriweather: ["Merriweather", "ui-serif", "Georgia", "serif"],
        slab:    ['"Zilla Slab"', "Georgia", "serif"],
        ultra:   ['"Ultra"', "Georgia", "serif"],
        rye:     ['"Rye"', "Georgia", "serif"],
        gothic:  ['"Oswald"', '"Arial Narrow"', "sans-serif"],
        press:   ['"Special Elite"', '"Courier New"', "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        board: "0 1px 2px rgba(26,23,18,0.04), 0 10px 28px -12px rgba(26,23,18,0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
