// RoomTierMap — the heat-map view of the venue, used by the composer's "Your
// spot" and "Demand" tabs. Renders the real rows grouped into PRICED tier bands
// (label + floor down the left), each seat a cell shaded by `mode`:
//
//   • "spot"   — the deterministic projected zone: the band your group lands in
//                glows, your exact seats are brightest with a ring, the rest sit
//                neutral. A dashed outline + a "where your group lands now"
//                callout mark the zone. NO percentages — visual-only until the
//                placement-odds engine (ADR-0020) exists.
//   • "demand" — honest current fill: each band is shaded on the marquee ramp
//                by how full it already is (cool = open, hot bronze = filling).
//
// Geometry is the simple flat band layout on purpose; the curved theater arc is
// per-venue layout data for the future venue builder, not hardcoded here.
//
// Dumb client component: no state, no fetching. It re-renders when the parent
// passes a fresh `yourSeats` from the debounced projection, and holds its last
// paint while a refresh is in flight (never blanks, never spins).

"use client";

import { useMemo } from "react";

import type { TierBand } from "@/lib/presenters";

type Props = {
  bands: readonly TierBand[];
  mode: "spot" | "demand";
  // The fan's projected seats — drives the "spot" highlight. null before any
  // projection (and ignored in "demand" mode).
  yourSeats: { rowId: string; numbers: readonly string[] } | null;
  venueName: string;
  capacity: number;
  // Dim very slightly while a fresh projection lands — reads as "settling".
  updating?: boolean;
};

const TARGET_ROW_WIDTH = 420;

const NEUTRAL = "var(--ink-100)";
const YOUR_SEAT = "var(--marquee-700)";
const YOUR_ZONE = "var(--marquee-300)";

// Cool → hot ramp for the "demand" view. Index 0 is "no offers yet" (neutral),
// then the four marquee steps climb to bronze as a band fills. Matches the
// markup's "less likely → more likely" gradient, repurposed for honest fill.
const DEMAND_RAMP = [
  NEUTRAL,
  "var(--marquee-100)",
  "var(--marquee-300)",
  "var(--marquee-500)",
  "var(--marquee-700)",
] as const;

function demandColor(fillRatio: number): string {
  if (fillRatio <= 0) return DEMAND_RAMP[0];
  if (fillRatio <= 0.33) return DEMAND_RAMP[1];
  if (fillRatio <= 0.66) return DEMAND_RAMP[2];
  if (fillRatio <= 0.9) return DEMAND_RAMP[3];
  return DEMAND_RAMP[4];
}

export function RoomTierMap({
  bands,
  mode,
  yourSeats,
  venueName,
  capacity,
  updating = false,
}: Props) {
  // Cell sizing mirrors LiveRoomMap so the three tabs feel like one room: size
  // from the widest row across every band.
  const { cellW, cellH, seatGap, rowGap } = useMemo(() => {
    const maxSeats = Math.max(
      1,
      ...bands.flatMap((b) => b.rows.map((r) => r.seats.length)),
    );
    const w = Math.min(
      14,
      Math.max(3, Math.floor((TARGET_ROW_WIDTH * 3) / (4 * maxSeats))),
    );
    const gap = w >= 9 ? 4 : w >= 6 ? 3 : w >= 4 ? 2 : 1;
    const h = Math.max(4, Math.round((w * 9) / 13));
    return { cellW: w, cellH: h, seatGap: gap, rowGap: Math.max(4, h) };
  }, [bands]);

  const yourRowId = yourSeats?.rowId ?? null;
  const yourNumbers = useMemo(
    () => new Set(yourSeats?.numbers ?? []),
    [yourSeats],
  );

  // Which band contains the fan's projected row — the one that glows in "spot".
  const yourTier = useMemo(() => {
    if (mode !== "spot" || yourRowId === null) return null;
    for (const b of bands) {
      if (b.rows.some((r) => r.rowId === yourRowId)) return b.tier;
    }
    return null;
  }, [bands, mode, yourRowId]);

  return (
    <div
      className={updating ? "auk-computing" : undefined}
      style={{
        opacity: updating ? 0.85 : 1,
        transition: "opacity var(--dur-base) var(--ease-out)",
      }}
    >
      <div
        className="flex flex-col"
        style={{ gap: 10 }}
        role="img"
        aria-label={
          mode === "spot"
            ? "Venue tier map showing where your group projects to land"
            : "Venue tier map shaded by how full each section is"
        }
      >
        {bands.map((band) => {
          const isYourBand = band.tier === yourTier;
          return (
            <div
              key={band.tier}
              className="rounded-lg"
              style={{
                position: "relative",
                padding: "10px 12px",
                background: isYourBand ? "var(--marquee-100)" : "var(--paper)",
                border: isYourBand
                  ? "1.5px dashed var(--marquee-700)"
                  : "1px solid var(--border)",
                transition:
                  "background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out)",
              }}
            >
              {/* Band header: tier + floor, and the "lands now" callout on the
                  fan's projected band. */}
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span
                  className="font-mono uppercase"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    color: "var(--fg-muted)",
                  }}
                >
                  {band.label}
                  {band.floorDisplay ? (
                    <span style={{ color: "var(--fg-subtle)" }}>
                      {" · "}
                      {band.floorDisplay}
                    </span>
                  ) : null}
                </span>
                {isYourBand ? (
                  <span
                    className="auk-textswap font-sans"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--marquee-700)",
                    }}
                  >
                    Where your group lands now
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col items-center" style={{ gap: rowGap }}>
                {band.rows.map((row) => {
                  const isYourRow = row.rowId === yourRowId;
                  return (
                    <div
                      key={row.rowId}
                      className="flex justify-center"
                      style={{ gap: seatGap }}
                    >
                      {row.seats.map((seat, i) => {
                        const yours =
                          mode === "spot" &&
                          isYourRow &&
                          yourNumbers.has(seat.number);
                        const color =
                          mode === "demand"
                            ? demandColor(band.fillRatio)
                            : yours
                              ? YOUR_SEAT
                              : isYourBand
                                ? YOUR_ZONE
                                : NEUTRAL;
                        return (
                          <span
                            key={`${row.rowId}-${seat.number}-${i}`}
                            className="auk-seat"
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

      <div className="mt-4 flex flex-wrap items-center gap-[18px]">
        {mode === "demand" ? (
          <>
            <LegendItem color={DEMAND_RAMP[0]} label="No offers yet" />
            <LegendRamp />
            <LegendItem color={DEMAND_RAMP[4]} label="Filling up" />
          </>
        ) : (
          <>
            <LegendItem color={YOUR_SEAT} label="Your seats" ring />
            <LegendItem color={YOUR_ZONE} label="Your section" />
            <LegendItem color={NEUTRAL} label="Other seats" />
          </>
        )}
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  ring = false,
}: {
  color: string;
  label: string;
  ring?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-[6px] font-sans"
      style={{ fontSize: 11, color: "var(--fg-muted)" }}
    >
      <i
        className="block"
        style={{
          width: 11,
          height: 8,
          borderRadius: 2,
          background: color,
          ...(ring
            ? { boxShadow: "0 0 0 1.5px var(--marquee-500)" }
            : null),
        }}
        aria-hidden
      />
      {label}
    </span>
  );
}

// The cool→hot swatch strip between the demand legend's two ends.
function LegendRamp() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[1, 2, 3].map((i) => (
        <i
          key={i}
          className="block"
          style={{
            width: 11,
            height: 8,
            borderRadius: 2,
            background: DEMAND_RAMP[i],
          }}
        />
      ))}
    </span>
  );
}
