// RoomMap — fairness made visible. A schematic of the *actual* venue with the
// fan's seats lit. Server component: pure presentation over the
// VenuePreviewView the route builds via presentFanVenuePreview (real
// VenueArchitecture rows + the show's real seat-assignment fill). No synthetic
// grid — every cell is a real seat.
//
// Rows are laid front (closest to stage) → back, Stage labelled at the top.
// We size the seat cells to fit the column from the widest real row, so a
// 1,200-seat house and a 200-seat room both read as a room rather than
// overflowing. Cells stay schematic on purpose; the only seats that need to
// pop are the fan's own, which carry a ring.

import type { FanSection } from "@/lib/presenters";

type Props = {
  sections: readonly FanSection[];
  venueName: string;
  capacity: number;
};

// Target row width (px) the widest row should fit within — comfortably inside
// the map column at 1000px and inside the single-column layout below 860px.
const TARGET_ROW_WIDTH = 352;

const COLOR = {
  yours: "var(--marquee-500)",
  placed: "var(--greenwood-300)",
  unfilled: "var(--ink-100)",
} as const;

export function RoomMap({ sections, venueName, capacity }: Props) {
  // Flatten to a front→back list of rows. Sections arrive closest-first and
  // each section's rows are already ordered by rowRank, so this preserves the
  // physical front-to-back order across the whole house.
  const rows = sections.flatMap((s) => s.rows);

  const maxSeats = Math.max(1, ...rows.map((r) => r.seats.length));
  // Solve cellW from a gap ≈ cellW/3 so the widest row lands near the target:
  // width ≈ cellW * (4·n − 1)/3. Clamp to a legible-but-compact band.
  const cellW = Math.min(
    13,
    Math.max(3, Math.floor((TARGET_ROW_WIDTH * 3) / (4 * maxSeats))),
  );
  const seatGap = cellW >= 9 ? 4 : cellW >= 6 ? 3 : cellW >= 4 ? 2 : 1;
  const cellH = Math.max(4, Math.round((cellW * 9) / 13));
  const rowGap = Math.max(4, cellH);

  return (
    <div>
      <div
        className="flex flex-col items-center"
        style={{ gap: rowGap }}
        aria-label="Venue seat map with your seats highlighted"
        role="img"
      >
        {rows.map((row) => (
          <div
            key={row.rowId}
            className="flex justify-center"
            style={{ gap: seatGap }}
          >
            {row.seats.map((seat, i) => {
              const isYours = seat.status === "yours";
              return (
                <span
                  key={`${row.rowId}-${seat.number}-${i}`}
                  style={{
                    width: cellW,
                    height: cellH,
                    borderRadius: 2,
                    background: COLOR[seat.status],
                    ...(isYours
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
        ))}
      </div>

      <div
        className="mt-[18px] flex justify-between font-mono uppercase"
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          color: "var(--fg-subtle)",
        }}
      >
        <span>Stage</span>
        <span>
          {venueName} · {capacity.toLocaleString("en-US")} seats
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-[18px]">
        <LegendItem color={COLOR.yours} label="Your seats" />
        <LegendItem color={COLOR.placed} label="Seated" />
        <LegendItem color={COLOR.unfilled} label="Empty" />
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
