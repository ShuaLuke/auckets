// Skeleton — shimmer placeholder blocks for the route loading.tsx files
// (UI-2 feel pack). The shimmer itself is the .auk-skeleton class in
// design-system.css (static under prefers-reduced-motion); this file is
// just the shapes, so every loading screen draws from the same kit and
// roughly matches the layout it stands in for.
//
// Server-safe: no state, no handlers — loading.tsx renders these
// instantly while the page's data fetch is in flight.

import { type CSSProperties } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`auk-skeleton ${className}`.trim()} style={style} />;
}

// A placeholder in the shape of the dashboard / shows-index / offers row
// cards: white card, date stub on the left, two text lines, a badge slot
// on the right.
export function SkeletonShowRow() {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-4 py-[18px] md:gap-5 md:px-5"
      style={{ background: "var(--page)", borderColor: "var(--border)" }}
    >
      <Skeleton style={{ width: 64, height: 58, flexShrink: 0 }} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
        <Skeleton style={{ height: 18, width: "55%", maxWidth: 220 }} />
        <Skeleton style={{ height: 13, width: "40%", maxWidth: 160 }} />
      </div>
      <Skeleton
        style={{ height: 24, width: 88, borderRadius: "var(--radius-pill)" }}
      />
    </div>
  );
}

// The standard "page header" placeholder: eyebrow line + display title.
export function SkeletonPageHeader() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton style={{ height: 11, width: 96 }} />
      <Skeleton style={{ height: 38, width: 240, maxWidth: "70%" }} />
    </div>
  );
}
