// The seat map for a simulation run: every seat on sale, each occupied seat
// shaded by the price its group paid. Hover a seat for the price, the group,
// and where that offer ranked.
//
// Two layouts over the same seats:
//   Seating chart — the room as a box-office chart: stage at the top, levels
//     behind one another, sections side by side, row A lined up across them.
//     Derived by seatingChart() from area / section / lean / row name, so it
//     works for any venue without per-venue drawing.
//   By seat rank — rows stacked by rowRank, best first. A fair room fades
//     smoothly from dark to light; a light seat near the top is a
//     fit-resolution or waterfall worth hovering.
//
// One hue, light → dark, binned by seat quantile (see priceBins) so a long
// price tail doesn't flatten the scale. Real curvature and rake belong to the
// venue builder; this stays schematic.

"use client";

import { memo, useId, useMemo, useRef, useState } from "react";

import { usd } from "@/lib/sim/format";
import { binIndexFor, priceBins, seatingChart, SEAT_HELD, type ChartLevel, type PriceBin, type SeatMapRow, type SeatMapView } from "@/lib/sim/seatmap";

type Props = { view: SeatMapView };

// Cheapest → dearest. Five steps from the Greenwood ramp; the second is mixed
// because the ramp has no 200.
export const SCALE = [
  "var(--greenwood-100)",
  "color-mix(in oklab, var(--greenwood-100), var(--greenwood-300))",
  "var(--greenwood-300)",
  "var(--greenwood-500)",
  "var(--greenwood-900)",
] as const;

const HELD_FILL = "repeating-linear-gradient(135deg, var(--ink-200) 0 2px, var(--ink-100) 2px 4px)";

// Spread n bins across the 5-step scale so two bins read as light vs dark,
// not as two neighbouring pales.
export function colorForBin(bin: number, binCount: number): string {
  if (binCount <= 1) return SCALE[2];
  return SCALE[Math.round((bin * (SCALE.length - 1)) / (binCount - 1))] ?? SCALE[2];
}

const SEATS_PER_LINE = 20; // wider rows (a GA pen) wrap
const RANK_W = 24;
const LABEL_CHAR_W = 5.5; // 9px mono
const LABEL_MAX_CHARS = 16;

// Seating chart
const CHART_W = 540; // what the results card gives us; wider rooms scroll
const AISLE = 12;
const ROW_LABEL_W = 16;
const UNIT_PER_LINE = 15; // a GA pen wraps
// One DOM node pair per seat. Fine for a theatre, not for a stadium.
export const MAX_DRAWN_SEATS = 6000;

type Layout = "chart" | "rank";

type Hover = { row: number; seat: number; x: number; y: number; below: boolean };

export function SimulationSeatMap({ view }: Props) {
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [layout, setLayout] = useState<Layout>("chart");
  const bins = useMemo(() => priceBins(view, SCALE.length), [view]);
  const colorOf = useMemo(() => view.offers.map((o) => colorForBin(binIndexFor(bins, o.priceCents), bins.length)), [view, bins]);
  const chart = useMemo(() => seatingChart(view), [view]);

  const maxSeats = Math.max(1, ...view.rows.map((r) => r.seats.length));
  const perLine = Math.min(maxSeats, SEATS_PER_LINE);
  // Big rooms get a tighter cell so two columns fit the results card.
  const cell = view.rows.length > 40 ? 8 : 11;
  const gap = 2;
  const seatsW = perLine * (cell + gap);
  // Sized to the longest "section row" label so seats start at the same x in
  // every row without the label column swallowing a small room's width.
  const labelW = Math.ceil(Math.min(LABEL_MAX_CHARS, Math.max(4, ...view.rows.map((r) => r.section.length + 1 + r.rowName.length))) * LABEL_CHAR_W);

  function onOver(e: React.MouseEvent<HTMLDivElement>): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-seat]");
    const wrap = wrapRef.current;
    if (!el || !wrap) {
      if (hover) setHover(null);
      return;
    }
    const [row, seat] = (el.dataset.seat ?? "").split(":").map(Number);
    if (row === undefined || seat === undefined) return;
    if (hover && hover.row === row && hover.seat === seat) return;
    const s = (el.firstElementChild ?? el).getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const x = Math.min(Math.max(s.left - w.left + s.width / 2, 120), Math.max(120, w.width - 120));
    const below = s.top - w.top < 140;
    setHover({ row, seat, x, y: below ? s.bottom - w.top : s.top - w.top, below });
  }

  const hoveredRow = hover ? view.rows[hover.row] : undefined;
  const hoveredCode = hoveredRow?.seats[hover?.seat ?? -1];
  const hoveredOffer = hoveredCode !== undefined && hoveredCode >= 0 ? view.offers[hoveredCode] : undefined;
  const total = view.placedSeats + view.emptySeats;

  return (
    <div>
      <div className="mb-3 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
        <strong style={{ color: "var(--fg)" }}>{view.placedSeats.toLocaleString("en-US")}</strong> of {total.toLocaleString("en-US")} seats filled ·{" "}
        {view.emptySeats.toLocaleString("en-US")} empty
        {view.heldSeats > 0 ? ` · ${view.heldSeats.toLocaleString("en-US")} held` : ""} · {view.offers.length.toLocaleString("en-US")} of{" "}
        {view.totalOffers.toLocaleString("en-US")} offers seated. {layout === "chart" ? "Stage at the top" : "Rows run best seat-rank first"}; hover a seat for what it went for.
      </div>

      <div className="mb-3 flex items-center gap-1">
        {(["chart", "rank"] as const).map((l) => {
          const on = layout === l;
          return (
            <button key={l} type="button" aria-pressed={on} className="rounded-full border px-2.5 py-0.5 font-sans text-[11px]" style={{ borderColor: on ? "var(--ink-900)" : "var(--border)", background: on ? "var(--ink-900)" : "transparent", color: on ? "var(--paper)" : "var(--fg-muted)" }} onClick={() => { setLayout(l); setHover(null); }}>
              {l === "chart" ? "Seating chart" : "By seat rank"}
            </button>
          );
        })}
      </div>

      <Legend bins={bins} hasHeld={view.heldSeats > 0} />

      <div ref={wrapRef} className="relative mt-4" data-simmap={uid} onMouseOver={onOver} onMouseMove={onOver} onMouseLeave={() => setHover(null)}>
        {hoveredOffer && hoveredCode !== undefined && (
          // The whole group lights up, so you can see who sat together.
          <style>{`[data-simmap="${uid}"] [data-o="${hoveredCode}"]>b{box-shadow:0 0 0 1.5px var(--page),0 0 0 3px var(--marquee-500);position:relative;z-index:1}`}</style>
        )}
        {total + view.heldSeats > MAX_DRAWN_SEATS ? (
          <p className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
            This room has {(total + view.heldSeats).toLocaleString("en-US")} seats — too many to draw seat by seat here. offers.csv has every seat and what it went for.
          </p>
        ) : layout === "chart" ? (
          <Chart view={view} chart={chart} colorOf={colorOf} />
        ) : (
          <RankList view={view} colorOf={colorOf} cell={cell} gap={gap} seatsW={seatsW} labelW={labelW} />
        )}

        {hover && hoveredRow && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 w-[232px] rounded-lg px-3 py-2.5 font-sans text-[12px] leading-snug shadow-lg"
            style={{
              left: hover.x,
              top: hover.y,
              transform: hover.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))",
              background: "var(--ink-900)",
              color: "var(--paper)",
            }}
          >
            {hoveredOffer ? (
              <>
                <div className="font-mono text-[15px] font-semibold">
                  {usd(hoveredOffer.priceCents)} <span className="text-[11px] font-normal opacity-70">per ticket</span>
                </div>
                <div className="mt-0.5 opacity-80">
                  {hoveredOffer.groupSize === 1 ? "Single" : `Group of ${hoveredOffer.groupSize}`} · {usd(hoveredOffer.priceCents * hoveredOffer.groupSize)} total
                </div>
                {hoveredOffer.raisedFromCents !== undefined && <div className="opacity-80">Auto-bid raised it from {usd(hoveredOffer.raisedFromCents)}</div>}
                <div className="mt-1.5 opacity-80">
                  Offer #{hoveredOffer.offerRank.toLocaleString("en-US")} of {view.totalOffers.toLocaleString("en-US")} <span className="font-mono opacity-70">({hoveredOffer.id})</span>
                </div>
                <div className="opacity-80">
                  Asked for {hoveredOffer.preference} → {hoveredOffer.outcome}
                </div>
              </>
            ) : (
              <div className="font-semibold">{hoveredCode === SEAT_HELD ? "Held seat — not on sale" : "Empty seat"}</div>
            )}
            <div className="mt-1.5 border-t pt-1.5 opacity-70" style={{ borderColor: "rgba(255,255,255,0.18)" }}>
              Seat rank #{hoveredRow.rowRank} · {hoveredRow.section} {hoveredRow.rowName}
              {hoveredRow.isGa ? "" : ` · seat ${hoveredRow.seatNumbers[hover.seat] ?? ""}`}
              {hoveredRow.tier ? ` · ${hoveredRow.tier.replace(/_/g, " ")}` : ""}
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 font-sans text-[11px]" style={{ color: "var(--fg-faint)" }}>
        Seed {view.seed}, policy {view.policy} — the first crowd drawn. Other seeds feed the report&apos;s percentiles but keep no seat-level output. The same data, seat by seat, is in offers.csv.
      </p>
    </div>
  );
}

// `whole` rounds to the dollar — averages land on odd cents that mean nothing in a legend.
export function priceRange(b: PriceBin, whole = false): string {
  const short = (c: number): string => (whole || c % 100 === 0 ? `$${Math.round(c / 100).toLocaleString("en-US")}` : usd(c));
  return b.minCents === b.maxCents ? short(b.minCents) : `${short(b.minCents)}–${short(b.maxCents)}`;
}

export function Legend({ bins, hasHeld, title = "Price paid per ticket", whole = false, emptyLabel = "Empty" }: { bins: PriceBin[]; hasHeld: boolean; title?: string; whole?: boolean; emptyLabel?: string }) {
  const swatch = (background: string, border?: string): JSX.Element => (
    <i aria-hidden className="block shrink-0" style={{ width: 12, height: 12, borderRadius: 2, background, ...(border && { boxShadow: `inset 0 0 0 1px ${border}` }) }} />
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-sans text-[11px]" style={{ color: "var(--fg-muted)" }}>
      <span className="font-semibold uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
        {title}
      </span>
      {bins.map((b, i) => (
        <span key={b.minCents} className="inline-flex items-center gap-1.5" title={`${b.seats.toLocaleString("en-US")} seats`}>
          {swatch(colorForBin(i, bins.length))}
          <span className="font-mono">{priceRange(b, whole)}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        {swatch("var(--page)", "var(--border-strong)")}
        {emptyLabel}
      </span>
      {hasHeld && (
        <span className="inline-flex items-center gap-1.5">
          {swatch(HELD_FILL)}
          Held
        </span>
      )}
    </div>
  );
}

// Each seat's hit box is the full pitch (swatch + gutter), so sweeping across
// a row never drops the hover card between cells.
function Seats({ row, rowIdx, colorOf, cell, gap, rowGap }: { row: SeatMapRow; rowIdx: number; colorOf: string[]; cell: number; gap: number; rowGap: number }) {
  return (
    <>
      {row.seats.map((code, si) => (
        <i key={si} data-seat={`${rowIdx}:${si}`} {...(code >= 0 && { "data-o": code })} className="block shrink-0" style={{ width: cell + gap, height: cell + rowGap }}>
          <b
            className="block"
            style={{
              width: cell,
              height: cell,
              borderRadius: 2,
              ...(code >= 0
                ? { background: colorOf[code] }
                : code === SEAT_HELD
                  ? { background: HELD_FILL }
                  : { background: "var(--page)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }),
            }}
          />
        </i>
      ))}
    </>
  );
}

const pretty = (s: string): string => s.replace(/_/g, " ");

// Both layouts are memoised: a 1,200-seat room is ~2,400 nodes, and hovering
// must not re-render them. The hover ring is a <style> rule in the parent.
type ChartProps = { view: SeatMapView; chart: ChartLevel[]; colorOf: string[] };

const Chart = memo(function Chart({ view, chart, colorOf }: ChartProps) {
  const gap = 2;
  // Size cells so the widest level fits the card; very wide rooms scroll.
  const widest = Math.max(1, ...chart.map((l) => l.widthSeats));
  const mostAisles = Math.max(0, ...chart.map((l) => l.sections.length - 1));
  const cell = Math.min(12, Math.max(5, Math.floor((CHART_W - mostAisles * AISLE - 2 * (ROW_LABEL_W + AISLE)) / widest) - gap));
  const pitch = cell + gap;
  const label = { fontSize: 9, lineHeight: `${pitch}px`, color: "var(--fg-faint)" } as const;

  return (
    <div role="img" aria-label={`Seating chart, stage at the top, shaded by price paid. ${view.placedSeats} seats filled, ${view.emptySeats} empty.`} className="overflow-x-auto pb-1">
      <div className="mx-auto w-fit">
        <div className="mx-auto mb-5 rounded-b-[40px] py-1.5 text-center font-sans text-[10px] font-semibold uppercase" style={{ width: "46%", minWidth: 120, letterSpacing: "0.18em", background: "var(--ink-100)", color: "var(--fg-subtle)" }}>
          Stage
        </div>

        {chart.map((level) => (
          <div key={level.area} className="mb-6 last:mb-0">
            <div className="mb-1.5 text-center font-sans text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
              {pretty(level.area)}
            </div>

            {level.lines.length > 0 && (
              <div className="mx-auto grid w-fit" style={{ gridTemplateColumns: `${ROW_LABEL_W}px ${level.sections.map((sec) => `${sec.width * pitch}px`).join(" ")} ${ROW_LABEL_W}px`, columnGap: AISLE }}>
                <span />
                {level.sections.map((sec) => (
                  <span key={sec.name} className="truncate pb-1 text-center font-mono" style={{ fontSize: 9, color: "var(--fg-subtle)" }} title={sec.name}>
                    {level.sections.length > 1 ? sec.name : ""}
                  </span>
                ))}
                <span />
                {level.lines.map((line, li) => (
                  <ChartLineRow key={`${line.rowName}-${li}`} view={view} level={level} rows={line.rows} rowName={line.rowName} colorOf={colorOf} cell={cell} gap={gap} labelStyle={label} />
                ))}
              </div>
            )}

            {level.units.length > 0 && (
              <div className="mx-auto flex flex-wrap justify-center" style={{ gap: 12, maxWidth: CHART_W, marginTop: level.lines.length > 0 ? 12 : 0 }}>
                {level.units.map((u) => {
                  const r = view.rows[u.row]!;
                  return (
                    <div key={r.id}>
                      <div className="truncate pb-0.5 text-center font-mono" style={{ fontSize: 9, color: "var(--fg-subtle)", maxWidth: Math.min(r.seats.length, UNIT_PER_LINE) * pitch }} title={`${u.label} · seat rank #${r.rowRank}`}>
                        {/* A lone pen named after its level ("GA" under GA) needs no second label. */}
                        {level.units.length === 1 && u.label.toLowerCase() === pretty(level.area).toLowerCase() ? "\u00a0" : u.label}
                      </div>
                      <div className="flex flex-wrap" style={{ width: Math.min(r.seats.length, UNIT_PER_LINE) * pitch }}>
                        <Seats row={r} rowIdx={u.row} colorOf={colorOf} cell={cell} gap={gap} rowGap={gap} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

type ChartLineRowProps = { view: SeatMapView; level: ChartLevel; rows: (number | null)[]; rowName: string; colorOf: string[]; cell: number; gap: number; labelStyle: React.CSSProperties };

function ChartLineRow({ view, level, rows, rowName, colorOf, cell, gap, labelStyle }: ChartLineRowProps) {
  return (
    <>
      <span className="text-right font-mono" style={labelStyle}>
        {rowName}
      </span>
      {level.sections.map((sec, si) => {
        const idx = rows[si];
        const r = idx === null || idx === undefined ? undefined : view.rows[idx];
        return (
          // Side blocks hug the aisle nearest the centre, so a short row sits
          // where it does in the room rather than floating mid-block.
          <div key={sec.name} className="flex" style={{ justifyContent: sec.side === "left" ? "flex-end" : sec.side === "right" ? "flex-start" : "center" }}>
            {r && idx !== null && idx !== undefined && <Seats row={r} rowIdx={idx} colorOf={colorOf} cell={cell} gap={gap} rowGap={gap} />}
          </div>
        );
      })}
      <span className="font-mono" style={labelStyle}>
        {rowName}
      </span>
    </>
  );
}

type RankListProps = { view: SeatMapView; colorOf: string[]; cell: number; gap: number; seatsW: number; labelW: number };

const RankList = memo(function RankList({ view, colorOf, cell, gap, seatsW, labelW }: RankListProps) {
  return (
    <div
      role="img"
      aria-label={`Seat map, ${view.rows.length} rows in seat-rank order, shaded by price paid. ${view.placedSeats} seats filled, ${view.emptySeats} empty.`}
      style={{ columnWidth: RANK_W + labelW + seatsW + 12, columnGap: 20 }}
    >
      {view.rows.map((r, ri) => {
        const tierHeading = r.tier !== undefined && r.tier !== view.rows[ri - 1]?.tier ? r.tier : undefined;
        return (
          <div key={r.id} style={{ breakInside: "avoid" }}>
            {tierHeading !== undefined && (
              <div className="pb-1 font-sans text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-subtle)", paddingTop: ri === 0 ? 0 : 8 }}>
                {pretty(tierHeading)}
              </div>
            )}
            <div className="flex items-start" style={{ gap: 6 }}>
              <span className="shrink-0 text-right font-mono" style={{ width: RANK_W, fontSize: 9, lineHeight: `${cell}px`, color: "var(--fg-faint)" }}>
                {r.rowRank}
              </span>
              <span className="shrink-0 truncate font-mono" style={{ width: labelW, fontSize: 9, lineHeight: `${cell}px`, color: "var(--fg-subtle)" }} title={`${r.area} · ${r.section} · row ${r.rowName}`}>
                {r.section} {r.rowName}
              </span>
              <div className="flex shrink-0 flex-wrap" style={{ width: seatsW }}>
                <Seats row={r} rowIdx={ri} colorOf={colorOf} cell={cell} gap={gap} rowGap={gap + 1} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
