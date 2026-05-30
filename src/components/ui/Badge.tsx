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
// The palette values are the prototype's exact hex codes. Future
// refactor could map them to the design system's CSS variables
// (--greenwood-50, --marquee-100, etc.), but going variable-by-variable
// when the prototype is authoritative would risk visual drift while
// the design is still being authored. Kept inline for now.

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
  placed: { bg: "#EEF3EE", fg: "#163823", dot: "#1F4A2E" },
  preview: { bg: "#F6E6CC", fg: "#8F6A2A", dot: "#C99A4B" },
  pending: { bg: "#F6E6CC", fg: "#8F6A2A", dot: "#C99A4B" },
  skipped: { bg: "#E8E6DE", fg: "#46443B", dot: "#6B6759" },
  unplaced: { bg: "#F2D9D3", fg: "#722417", dot: "#A93C2A" },
  open: { bg: "#EEF3EE", fg: "#1F4A2E", dot: "#2D5C3A" },
  upcoming: { bg: "#E8E6DE", fg: "#46443B", dot: "#6B6759" },
  inverse: { bg: "#0E0F0C", fg: "#F4F1E8", dot: "#F4F1E8" },
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
