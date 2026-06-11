// Badge — pill-shaped status tag with optional leading dot. Matches
// the prototype's Badge from design/ui_kits/auckets/components/Surfaces.jsx.
//
// Tones map to status semantics:
//   placed   — your offer made it into a seat (Greenwood)
//   preview  — provisional / pending (Marquee amber)
//   pending  — alias for preview, kept for prototype parity
//   skipped  — explicitly not placed (muted ink)
//   unplaced — placement failed (Brick red)
//   open     — show's offer window is open. Greenwood green (a live
//              "open for business" signal), distinct from `placed` by a
//              brighter dot and, on focal surfaces, an opt-in pulse.
//              Being "open" is a show state, not a fan-offer outcome.
//   upcoming — show is announced but window hasn't opened yet (muted)
//   inverse  — dark pill on light surface (used in inverse cards)
//
// The palette maps to the design-system CSS variables. Each variable's
// value is the prototype's exact hex code (verified one-for-one against
// design-system.css before the swap), so this is drift-proofing with
// zero visual change: if the system palette moves, badges move with it.

import { type HTMLAttributes } from "react";

export type BadgeTone =
  | "placed"
  | "preview"
  | "pending"
  | "skipped"
  | "unplaced"
  | "open"
  | "upcoming"
  | "inverse";

const palettes: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  placed: {
    bg: "var(--greenwood-50)",
    fg: "var(--greenwood-700)",
    dot: "var(--greenwood-600)",
  },
  preview: {
    bg: "var(--marquee-100)",
    fg: "var(--marquee-700)",
    dot: "var(--marquee-500)",
  },
  pending: {
    bg: "var(--marquee-100)",
    fg: "var(--marquee-700)",
    dot: "var(--marquee-500)",
  },
  skipped: {
    bg: "var(--ink-100)",
    fg: "var(--ink-500)",
    dot: "var(--ink-400)",
  },
  unplaced: {
    bg: "var(--brick-100)",
    fg: "var(--brick-700)",
    dot: "var(--brick-500)",
  },
  open: {
    bg: "var(--greenwood-50)",
    fg: "var(--greenwood-600)",
    dot: "var(--greenwood-500)",
  },
  upcoming: {
    bg: "var(--ink-100)",
    fg: "var(--ink-500)",
    dot: "var(--ink-400)",
  },
  inverse: {
    bg: "var(--ink-900)",
    fg: "var(--paper)",
    dot: "var(--paper)",
  },
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  dot?: boolean;
  // When true, the leading dot gets a soft "live" pulse — a ping halo
  // behind the solid dot. Opt-in (default off) so list rows stay quiet;
  // focal surfaces like the Show-page header turn it on to signal the
  // window is actively open. Honors prefers-reduced-motion via the
  // motion-safe: variant, so the dot stays static for users who opt out.
  pulse?: boolean;
};

export function Badge({
  tone = "placed",
  dot = true,
  pulse = false,
  className = "",
  children,
  style,
  ...rest
}: Props) {
  const p = palettes[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-sans text-[11px] font-semibold whitespace-nowrap ${className}`.trim()}
      style={{
        background: p.bg,
        color: p.fg,
        letterSpacing: "0.02em",
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
          {pulse && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
              style={{ background: p.dot }}
            />
          )}
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: p.dot }}
          />
        </span>
      )}
      {children}
    </span>
  );
}
