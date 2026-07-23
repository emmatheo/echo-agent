import type { Config } from "tailwindcss";

/**
 * Echo Agent design tokens.
 * Palette + type roles are derived from the matchday reference:
 * near-black canvas, gold accent, condensed poster display.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0D",
        carbon: "#141417",
        panel: "#17171B",
        line: "#26262B",
        gold: "#C9A24B",
        goldbright: "#E7C877",
        bone: "#EDEBE6",
        muted: "#8A8A93",
        pitch: "#0E1A12",
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: { tightest: "-0.04em" },
      keyframes: {
        ribbon: {
          "0%": { transform: "translateX(-120%) skewX(-18deg)" },
          "100%": { transform: "translateX(220%) skewX(-18deg)" },
        },
        beam: { to: { transform: "rotate(360deg)" } },
        shine: {
          "0%": { backgroundPosition: "200% center" },
          "100%": { backgroundPosition: "-200% center" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseDot: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        ribbon: "ribbon 1.1s ease-in-out",
        beam: "beam 6s linear infinite",
        shine: "shine 6s linear infinite",
        fadeUp: "fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) both",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
