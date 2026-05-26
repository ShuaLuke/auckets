// Badge — pill-shaped status tag with optional leading dot. Matches
// the prototype's Badge from design/ui_kits/auckets/components/Surfaces.jsx.
//
// Tones map to status semantics:
//   placed   — your offer made it into a seat (Greenwood)
//   preview  — provisional / pending (Marquee amber)
//   pending  — alias for preview, kept for prototype parity
//   skipped  — explicitly not placed (muted ink)
//   unplaced — placement failed (Brick red)
//   open     — show's offer window is open (Marquee — distinct from
//              placed because being "open" is a show state, not a
//              fan-offer outcome)
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
  open: { bg: "#F6E6CC", fg: "#8F6A2A", dot: "#C99A4B" },
  upcoming: { bg: "#E8E6DE", fg: "#46443B", dot: "#6B6759" },
  inverse: { bg: "#0E0F0C", fg: "#F4F1E8", dot: "#F4F1E8" },
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  dot?: boolean;
};

export function Badge({
  tone = "placed",
  dot = true,
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
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: p.dot }}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
