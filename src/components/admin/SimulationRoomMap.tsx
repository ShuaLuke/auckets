// The room at two zoom levels, for a simulation run.
//
//   Sections   — one block per section, shaded by the average price paid
//                there, with a fill bar. Small enough to ship and draw for a
//                43,000-seat ballpark. Click a block to open it.
//   Every seat — the full seat map (SimulationSeatMap), when the room is
//                small enough to have been sent and to draw.
//
// Opening a section shows it seat by seat. The seats come from the full view
// when the response carried one (a theatre); otherwise `loadArea` fetches
// that level on demand (a stadium's seat map is ~3 MB a policy and never
// fits), and the level is kept so its other sections open instantly.
//
// Blocks are grouped by level and by the name they share ("Field Box": 104,
// 105, …), in natural order so neighbours in the numbering sit together.
// That is as much geometry as a manifest carries — there is no bowl to draw
// until a venue has real section positions, which belong to the venue
// builder.

"use client";

import { useMemo, useRef, useState } from "react";

import { colorForBin, Legend, MAX_DRAWN_SEATS, SCALE, SimulationSeatMap } from "@/components/admin/SimulationSeatMap";
import { usd } from "@/lib/sim/format";
import { binIndexFor, filterSeatMapView, quantileBins, type SeatMapView, type SectionMapView, type SectionSummary } from "@/lib/sim/seatmap";

type Props = {
  sections: SectionMapView;
  view?: SeatMapView | undefined;
  loadArea?: ((area: string) => Promise<SeatMapView>) | undefined;
};

type Mode = "sections" | "seats";
type Open = { area: string; section: string };
type Group = { heading: string | null; tiles: { sec: SectionSummary; index: number; label: string }[] };
type Level = { area: string; groups: Group[]; seats: number; placedSeats: number; grossCents: number };

const pretty = (s: string): string => s.replace(/_/g, " ");
const n = (v: number): string => v.toLocaleString("en-US");
const natural = (a: string, b: string): number => a.localeCompare(b, "en-US", { numeric: true });

// "Field Box 104" → ["Field Box", "104"]. Sections that share a lead-in are
// drawn under it with just their number; a one-off keeps its whole name.
function levelsOf(map: SectionMapView): Level[] {
  const levels: Level[] = [];
  map.sections.forEach((sec, index) => {
    let level = levels.find((l) => l.area === sec.area);
    if (!level) {
      level = { area: sec.area, groups: [], seats: 0, placedSeats: 0, grossCents: 0 };
      levels.push(level);
    }
    level.seats += sec.seats;
    level.placedSeats += sec.placedSeats;
    level.grossCents += sec.grossCents;
    const words = sec.section.trim().split(/\s+/);
    const heading = words.length > 1 ? words.slice(0, -1).join(" ") : null;
    let group = level.groups.find((g) => g.heading === heading);
    if (!group) {
      group = { heading, tiles: [] };
      level.groups.push(group);
    }
    group.tiles.push({ sec, index, label: heading === null ? sec.section : words.at(-1)! });
  });
  for (const level of levels) {
    const loners: Group = { heading: null, tiles: [] };
    const shared: Group[] = [];
    for (const g of level.groups) {
      if (g.heading !== null && g.tiles.length > 1) shared.push(g);
      else loners.tiles.push(...g.tiles.map((t) => ({ ...t, label: t.sec.section })));
    }
    level.groups = [...shared, ...(loners.tiles.length > 0 ? [loners] : [])];
    for (const g of level.groups) g.tiles.sort((a, b) => natural(a.sec.section, b.sec.section));
  }
  return levels;
}

export function SimulationRoomMap({ sections, view, loadArea }: Props) {
  const total = sections.placedSeats + sections.emptySeats + sections.heldSeats;
  const canDrawAll = view !== undefined && total <= MAX_DRAWN_SEATS;
  const [mode, setMode] = useState<Mode>(canDrawAll ? "seats" : "sections");
  const [open, setOpen] = useState<Open | null>(null);
  const [areaViews, setAreaViews] = useState<Record<string, SeatMapView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number; below: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const levels = useMemo(() => levelsOf(sections), [sections]);
  const bins = useMemo(() => quantileBins(sections.sections.flatMap((s) => (s.avgPriceCents === null ? [] : [[s.avgPriceCents, s.placedSeats] as [number, number]])), SCALE.length), [sections]);

  async function openSection(sec: SectionSummary): Promise<void> {
    setHover(null);
    setError(null);
    setOpen({ area: sec.area, section: sec.section });
    if (view || areaViews[sec.area] || !loadArea) return;
    setLoading(true);
    try {
      const loaded = await loadArea(sec.area);
      setAreaViews((cur) => ({ ...cur, [sec.area]: loaded }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the seats");
    } finally {
      setLoading(false);
    }
  }

  const source = open ? (view ?? areaViews[open.area]) : undefined;
  const sectionView = useMemo(() => (open && source ? filterSeatMapView(source, (r) => r.area === open.area && r.section === open.section) : undefined), [open, source]);

  function onOver(e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sec]");
    const wrap = wrapRef.current;
    if (!el || !wrap) {
      if (hover) setHover(null);
      return;
    }
    const index = Number(el.dataset.sec);
    if (hover?.index === index) return;
    const s = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const x = Math.min(Math.max(s.left - w.left + s.width / 2, 124), Math.max(124, w.width - 124));
    const below = s.top - w.top < 150;
    setHover({ index, x, y: below ? s.bottom - w.top : s.top - w.top, below });
  }

  const hovered = hover ? sections.sections[hover.index] : undefined;
  const pill = (on: boolean): React.CSSProperties => ({ borderColor: on ? "var(--ink-900)" : "var(--border)", background: on ? "var(--ink-900)" : "transparent", color: on ? "var(--paper)" : "var(--fg-muted)" });

  return (
    <div>
      {canDrawAll && (
        <div className="mb-4 flex items-center gap-1">
          {(["seats", "sections"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} className="rounded-full border px-2.5 py-0.5 font-sans text-[11px]" style={pill(mode === m)} onClick={() => { setMode(m); setOpen(null); setHover(null); }}>
              {m === "seats" ? "Every seat" : "Sections"}
            </button>
          ))}
        </div>
      )}

      {mode === "seats" && view ? (
        <SimulationSeatMap view={view} />
      ) : open ? (
        <div>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <button type="button" className="font-sans text-[12px] underline underline-offset-2" style={{ color: "var(--fg-muted)" }} onClick={() => { setOpen(null); setError(null); }}>
              ← All sections
            </button>
            <span className="font-sans text-[15px] font-semibold">{open.section}</span>
            <span className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
              {pretty(open.area)}
            </span>
          </div>
          {sectionView ? (
            <SimulationSeatMap view={sectionView} />
          ) : error ? (
            <p className="font-sans text-[13px]" style={{ color: "#8a1f1f" }}>
              {error}
            </p>
          ) : (
            <p className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
              {loading ? `Loading the seats in ${pretty(open.area)}… This re-runs the first crowd for this policy, so a stadium takes a few seconds. The rest of the level then opens instantly.` : "Seat-by-seat detail wasn't kept for this run."}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-3 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
            <strong style={{ color: "var(--fg)" }}>{n(sections.placedSeats)}</strong> of {n(sections.placedSeats + sections.emptySeats)} seats filled · {n(sections.emptySeats)} empty
            {sections.heldSeats > 0 ? ` · ${n(sections.heldSeats)} held` : ""} · {n(sections.seatedOffers)} of {n(sections.totalOffers)} offers seated. One block per section, shaded by the average price paid there; the bar is how full it is. Click a section to see every seat.
          </div>

          <Legend bins={bins} hasHeld={false} title="Average price paid per ticket" whole emptyLabel="Nobody seated" />

          <div ref={wrapRef} className="relative mt-5" onMouseOver={onOver} onMouseMove={onOver} onMouseLeave={() => setHover(null)} onFocus={onOver} onBlur={() => setHover(null)}>
            {levels.map((level) => (
              <div key={level.area} className="mb-5 last:mb-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 border-b pb-1" style={{ borderColor: "var(--border)" }}>
                  <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg)" }}>
                    {pretty(level.area)}
                  </span>
                  <span className="font-sans text-[11px]" style={{ color: "var(--fg-subtle)" }}>
                    {n(level.placedSeats)} of {n(level.seats)} seats
                    {level.placedSeats > 0 ? ` · avg ${usd(Math.round(level.grossCents / level.placedSeats))}` : ""}
                  </span>
                </div>
                {level.groups.map((g) => (
                  <div key={g.heading ?? "—"} className="mb-2 flex items-start gap-2 last:mb-0">
                    {g.heading !== null && (
                      <span className="shrink-0 truncate font-mono" style={{ width: 92, fontSize: 10, lineHeight: "32px", color: "var(--fg-subtle)" }} title={g.heading}>
                        {g.heading}
                      </span>
                    )}
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {g.tiles.map(({ sec, index, label }) => (
                        <Tile key={`${sec.area}/${sec.section}`} sec={sec} index={index} label={label} bin={sec.avgPriceCents === null ? null : binIndexFor(bins, sec.avgPriceCents)} binCount={bins.length} onOpen={() => void openSection(sec)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {hover && hovered && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-10 w-[240px] rounded-lg px-3 py-2.5 font-sans text-[12px] leading-snug shadow-lg"
                style={{ left: hover.x, top: hover.y, transform: hover.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))", background: "var(--ink-900)", color: "var(--paper)" }}
              >
                <div className="font-semibold">{hovered.section}</div>
                {hovered.avgPriceCents !== null && hovered.minPriceCents !== null && hovered.maxPriceCents !== null ? (
                  <>
                    <div className="mt-1 font-mono text-[15px] font-semibold">
                      {usd(hovered.avgPriceCents)} <span className="text-[11px] font-normal opacity-70">average per ticket</span>
                    </div>
                    <div className="opacity-80">
                      {hovered.minPriceCents === hovered.maxPriceCents ? `Every seat went for ${usd(hovered.minPriceCents)}` : `From ${usd(hovered.minPriceCents)} to ${usd(hovered.maxPriceCents)}`} · {usd(hovered.grossCents)} in all
                    </div>
                  </>
                ) : (
                  <div className="mt-1 opacity-80">Nobody was seated here</div>
                )}
                <div className="mt-1.5 opacity-80">
                  {n(hovered.placedSeats)} of {n(hovered.seats)} seats filled
                  {hovered.emptySeats > 0 ? ` · ${n(hovered.emptySeats)} empty` : ""}
                  {hovered.heldSeats > 0 ? ` · ${n(hovered.heldSeats)} held` : ""} · {n(hovered.offers)} {hovered.offers === 1 ? "group" : "groups"}
                </div>
                <div className="mt-1.5 border-t pt-1.5 opacity-70" style={{ borderColor: "rgba(255,255,255,0.18)" }}>
                  {n(hovered.rows)} {hovered.rows === 1 ? "row" : "rows"}, seat rank #{n(hovered.bestRowRank)}
                  {hovered.worstRowRank !== hovered.bestRowRank ? `–#${n(hovered.worstRowRank)}` : ""}
                  {hovered.tiers.length > 0 ? ` · ${hovered.tiers.map(pretty).join(", ")}` : ""}
                </div>
              </div>
            )}
          </div>

          <p className="mt-4 font-sans text-[11px]" style={{ color: "var(--fg-faint)" }}>
            Seed {sections.seed}, policy {sections.policy} — the first crowd drawn. Sections are grouped by level and name, in numbering order; this isn&apos;t a drawing of the building.
          </p>
        </div>
      )}
    </div>
  );
}

type TileProps = { sec: SectionSummary; index: number; label: string; bin: number | null; binCount: number; onOpen: () => void };

function Tile({ sec, index, label, bin, binCount, onOpen }: TileProps) {
  const background = bin === null ? "var(--page)" : colorForBin(bin, binCount);
  // The two darkest steps need light text; everything else reads in ink.
  const dark = bin !== null && SCALE.indexOf(background as (typeof SCALE)[number]) >= 3;
  const ink = dark ? "var(--paper)" : bin === null ? "var(--fg-faint)" : "var(--ink-900)";
  const fill = sec.seats === 0 ? 0 : sec.placedSeats / sec.seats;
  return (
    <button
      type="button"
      data-sec={index}
      aria-label={`${sec.section}: ${sec.avgPriceCents === null ? "nobody seated" : `average ${usd(sec.avgPriceCents)}`}, ${sec.placedSeats} of ${sec.seats} seats filled`}
      className="relative overflow-hidden rounded-[4px] px-1.5 text-center font-mono outline-offset-2 hover:ring-2 hover:ring-[color:var(--marquee-500)] focus-visible:ring-2 focus-visible:ring-[color:var(--marquee-500)]"
      style={{ minWidth: 40, height: 32, fontSize: 10, lineHeight: "26px", background, color: ink, ...(bin === null && { boxShadow: "inset 0 0 0 1px var(--border-strong)" }) }}
      onClick={onOpen}
    >
      {label}
      <span aria-hidden className="absolute inset-x-0 bottom-0 block" style={{ height: 3, background: dark ? "rgba(255,255,255,0.22)" : "rgba(14,15,12,0.12)" }}>
        <span className="block h-full" style={{ width: `${Math.round(fill * 100)}%`, background: ink, opacity: bin === null ? 0.4 : 0.75 }} />
      </span>
    </button>
  );
}
