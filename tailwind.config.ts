import type { Config } from "tailwindcss";

// Tailwind theme tokens point at the design system's CSS variables
// (defined in src/app/design-system.css). That way components can
// reach for either `font-sans` (Tailwind class, compiles to
// `var(--font-sans)`) or `var(--font-sans)` directly in arbitrary
// values — both routes go through the same source of truth.
//
// We intentionally don't enumerate every color in the design system
// here. The bespoke palette (ink/paper/greenwood/marquee/brick) is
// used via arbitrary values (`bg-[#F4F1E8]`) or CSS variables
// (`bg-[var(--paper)]`) in components. Adding named tokens for each
// shade would be ~50 entries of mostly-aliasing without a real
// payoff. If a token gets used 3+ times across components, we can
// promote it here.
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-display)"],
      },
    },
  },
  plugins: [],
};

export default config;
