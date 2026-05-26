// =============================================================
// Auckets Design System — Tailwind config
// Replaces `tailwind.config.ts` at the repo root.
// =============================================================

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/email/templates/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  "#F7F6F2",
          100: "#E8E6DE",
          200: "#C8C4B7",
          300: "#9C9789",
          400: "#6B6759",
          500: "#46443B",
          600: "#2C2B25",
          700: "#1C1B17",
          800: "#131210",
          900: "#0E0F0C",
        },
        paper:   "#F4F1E8",
        "paper-2": "#ECE7D9",
        "paper-3": "#DDD6C1",
        page:    "#FFFFFF",
        greenwood: {
          50:  "#EEF3EE",
          100: "#D5E2D5",
          300: "#6A8F6F",
          500: "#2D5C3A",
          600: "#1F4A2E",   // primary brand
          700: "#163823",
          900: "#0C2014",
        },
        marquee: {
          100: "#F6E6CC",
          300: "#E5BC79",
          500: "#C99A4B",
          700: "#8F6A2A",
        },
        brick: {
          100: "#F2D9D3",
          500: "#A93C2A",
          700: "#722417",
        },
        // Semantic aliases
        fg:           "#0E0F0C",
        "fg-muted":   "#46443B",
        "fg-subtle":  "#6B6759",
        "fg-faint":   "#9C9789",
        "fg-on-ink":  "#F4F1E8",
        bg:           "#F4F1E8",
        "bg-elevated": "#FFFFFF",
        "bg-sunken":   "#ECE7D9",
        "bg-inverse":  "#0E0F0C",
        brand:        "#1F4A2E",
        "brand-hover": "#163823",
      },
      fontFamily: {
        display: ['var(--font-display)', "Bricolage Grotesque", "Inter Tight", "system-ui", "sans-serif"],
        sans:    ['var(--font-sans)',    "Geist", "system-ui", "-apple-system", "sans-serif"],
        mono:    ['var(--font-mono)',    "JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs":  ["0.6875rem", { lineHeight: "1.4" }],
        xs:     ["0.75rem",   { lineHeight: "1.45" }],
        sm:     ["0.8125rem", { lineHeight: "1.45" }],
        base:   ["0.9375rem", { lineHeight: "1.6" }],
        md:     ["1rem",      { lineHeight: "1.6" }],
        lg:     ["1.125rem",  { lineHeight: "1.55" }],
        xl:     ["1.375rem",  { lineHeight: "1.2" }],
        "2xl":  ["1.75rem",   { lineHeight: "1.2" }],
        "3xl":  ["2.25rem",   { lineHeight: "1.15" }],
        "4xl":  ["3rem",      { lineHeight: "1.1" }],
        "5xl":  ["4.25rem",   { lineHeight: "1.05" }],
        "6xl":  ["6rem",      { lineHeight: "1.0" }],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter:  "-0.025em",
        tight:    "-0.015em",
        wider:    "0.08em",
        widest:   "0.16em",
      },
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "20px",
        pill: "999px",
      },
      spacing: {
        // Already in Tailwind by default; extending with semantic names.
      },
      boxShadow: {
        flat:    "0 0 0 1px rgba(14,15,12,0.12)",
        sm:      "0 1px 2px rgba(14,15,12,0.04), 0 0 0 1px rgba(14,15,12,0.12)",
        md:      "0 4px 12px rgba(14,15,12,0.06), 0 0 0 1px rgba(14,15,12,0.12)",
        lg:      "0 16px 32px rgba(14,15,12,0.10), 0 0 0 1px rgba(14,15,12,0.12)",
        marquee: "0 0 0 1px #0E0F0C, 4px 4px 0 0 #0E0F0C",
      },
      transitionTimingFunction: {
        out:  "cubic-bezier(0.2, 0.7, 0.2, 1)",
        snap: "cubic-bezier(0.3, 1.4, 0.5, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "320ms",
      },
    },
  },
  plugins: [],
};

export default config;
