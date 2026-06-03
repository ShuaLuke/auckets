// LiveRoomMap — the centerpiece of the redesigned composer (Change 04). A
// schematic of the real venue (from presentFanVenuePreview) whose "your seats"
// highlight moves live as the fan turns the price dial. Client component: it
// holds no state itself, but re-renders instantly when the parent passes a new
// `yourSeats` from the debounced projection — the map holds its last state
// while a refresh is in flight (never blanks, never spins).
//
// Driven by REAL VenueArchitecture + seat-assignment fill, not a synthetic
// grid. Base seats (other fans / empty) come baked in; the fan's own projected
// seats are overlaid here so they can change without re-fetching the map.

"use client";

import { useMemo } from "react";

import type { FanSection } from "@/lib/presenters";

type Props = {
  sections: readonly FanSection[];
  venueName: string;
  capacity: number;
  // The fan's projected seats — re-shaded live. null before any projection.
  yourSeats: { rowId: string; numbers: readonly string[] } | null;
  // Dim very slightly while a fresh projection is loading, so the map reads as
  // "settling" rather than stale — but it never blanks.
  updating?: boolean;
};

const TARGET_ROW_WIDTH = 420;

const COLOR = {
  yours: "var(--marquee-500)",
  placed: "var(--greenwood-300)",
  unfilled: "var(--ink-100)",
} as const;

export function LiveRoomMap({
  sections,
  venueName,
  capacity,
  yourSeats,
  updating = false,
}: Props) {
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const { cellW, cellH, seatGap, rowGap } = useMemo(() => {
    const maxSeats = Math.max(1, ...rows.map((r) => r.seats.length));
    const w = Math.min(
      14,
      Math.max(3, Math.floor((TARGET_ROW_WIDTH * 3) / (4 * maxSeats))),
    );
    const gap = w >= 9 ? 4 : w >= 6 ? 3 : w >= 4 ? 2 : 1;
    const h = Math.max(4, Math.round((w * 9) / 13));
    return { cellW: w, cellH: h, seatGap: gap, rowGap: Math.max(4, h) };
  }, [rows]);

  const yourRowId = yourSeats?.rowId ?? null;
  const yourNumbers = useMemo(
    () => new Set(yourSeats?.numbers ?? []),
    [yourSeats],
  );

  return (
    <div
      style={{
        opacity: updating ? 0.85 : 1,
        transition: "opacity var(--dur-base) var(--ease-out)",
      }}
    >
      <div
        className="flex flex-col items-center"
        style={{ gap: rowGap }}
        role="img"
        aria-label="Venue seat map with your projected seats highlighted"
      >
        {rows.map((row) => {
          const isYourRow = row.rowId === yourRowId;
          return (
            <div
              key={row.rowId}
              className="flex justify-center"
              style={{ gap: seatGap }}
            >
              {row.seats.map((seat, i) => {
                const yours = isYourRow && yourNumbers.has(seat.number);
                const color = yours
                  ? COLOR.yours
                  : seat.status === "placed"
                    ? COLOR.placed
                    : COLOR.unfilled;
                return (
                  <span
                    key={`${row.rowId}-${seat.number}-${i}`}
                    style={{
                      width: cellW,
                      height: cellH,
                      borderRadius: 2,
                      background: color,
                      ...(yours
                        ? {
                            boxShadow:
                              "0 0 0 2px var(--ink-900), 0 0 0 4px var(--marquee-500)",
                            position: "relative",
                            zIndex: 2,
                          }
                        : null),
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div
        className="mt-[18px] flex justify-between font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--fg-subtle)" }}
      >
        <span>Stage</span>
        <span>
          {venueName} · {capacity.toLocaleString("en-US")} seats
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-[18px]">
        <LegendItem color={COLOR.yours} label="Your seats" />
        <LegendItem color={COLOR.placed} label="Taken" />
        <LegendItem color={COLOR.unfilled} label="Open" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] font-sans"
      style={{ fontSize: 11, color: "var(--fg-muted)" }}
    >
      <i
        className="block"
        style={{ width: 11, height: 8, borderRadius: 2, background: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}
