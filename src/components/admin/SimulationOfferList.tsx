// The ranked offers beside the seat map — act two of the demo, and the
// link to act three: every offer in rank order, what it asked for, and
// where it landed (or why it didn't). Hover a row and that group's seats
// light up on the map; hover a seat and its row lights up here and
// scrolls into view. State lives in SimulationSeatMap, which owns the
// map's hover; this is the list and nothing else.

"use client";

import { memo, useEffect, useRef } from "react";

import { usd } from "@/lib/sim/format";
import type { SeatMapOffer, UnseatedOffer } from "@/lib/sim/seatmap";

// One DOM row per offer; a stadium's 50k would be too many to hang off a hover.
export const MAX_LISTED_OFFERS = 6000;

type Props = {
  offers: SeatMapOffer[];
  unseated: UnseatedOffer[];
  totalOffers: number;
  active: number | null; // index into offers (the seat hovered on the map)
  onHover: (idx: number | null) => void; // a row hovered here → seats on the map
};

const n = (v: number): string => v.toLocaleString("en-US");

export const SimulationOfferList = memo(function SimulationOfferList({ offers, unseated, totalOffers, active, onHover }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active === null) return;
    const row = boxRef.current?.querySelector<HTMLElement>(`[data-offer="${active}"]`);
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (offers.length + unseated.length > MAX_LISTED_OFFERS) {
    return (
      <p className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
        {n(totalOffers)} offers — too many to list here. offers.csv has every one, in rank order, with where it landed.
      </p>
    );
  }

  const th = "sticky top-0 pb-1 text-left font-sans text-[10px] font-semibold uppercase tracking-wide";
  const td = "py-[3px] font-mono text-[11px]";
  return (
    <div>
      <div className="mb-2 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
        <strong style={{ color: "var(--fg)" }}>{n(totalOffers)}</strong> offers, best first: price per ticket, then a larger group ahead of a smaller one, then whoever offered first. {n(offers.length)} seated · {n(unseated.length)} not. Hover an offer to see its seats; hover a seat to find its offer.
      </div>
      <div ref={boxRef} className="overflow-y-auto rounded-lg border" style={{ maxHeight: 360, borderColor: "var(--border)" }} onMouseLeave={() => onHover(null)}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ color: "var(--fg-subtle)", background: "var(--page)" }}>
              <th className={`${th} pl-2 pr-2 text-right`}>#</th>
              <th className={`${th} pr-2 text-right`}>Group</th>
              <th className={`${th} pr-2 text-right`}>Per ticket</th>
              <th className={`${th} pr-2`}>Asked for</th>
              <th className={`${th} pr-2`}>Seated in</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o, idx) => {
              const on = active === idx;
              return (
                <tr key={o.id} data-offer={idx} onMouseEnter={() => onHover(idx)} style={{ background: on ? "var(--marquee-100, #fdf3d8)" : "transparent", borderTop: "1px solid var(--border)", cursor: "default" }}>
                  <td className={`${td} pl-2 pr-2 text-right`} style={{ color: "var(--fg-subtle)" }}>
                    {o.offerRank}
                  </td>
                  <td className={`${td} pr-2 text-right`}>{o.groupSize}</td>
                  <td className={`${td} pr-2 text-right`}>
                    {usd(o.priceCents)}
                    {o.raisedFromCents !== undefined ? <span style={{ color: "var(--fg-faint)" }}> ↑</span> : ""}
                    {o.paidCents !== undefined ? <span style={{ color: "var(--fg-faint)" }}> paid {usd(o.paidCents)}</span> : ""}
                  </td>
                  <td className={`${td} pr-2`} style={{ color: "var(--fg-muted)" }}>
                    {o.preference}
                  </td>
                  <td className={`${td} pr-2`}>
                    <span style={{ color: "var(--fg)" }}>#{o.rowRank}</span> <span style={{ color: "var(--fg-muted)" }}>{o.rowLabel}</span>
                    {o.outcome === "waterfalled down" || o.outcome === "moved up" ? <span style={{ color: "var(--fg-faint)" }}> · {o.outcome}</span> : ""}
                  </td>
                </tr>
              );
            })}
            {unseated.map((o) => (
              <tr key={o.id} style={{ borderTop: "1px solid var(--border)", color: "var(--fg-faint)" }}>
                <td className={`${td} pl-2 pr-2 text-right`}>{o.offerRank}</td>
                <td className={`${td} pr-2 text-right`}>{o.groupSize}</td>
                <td className={`${td} pr-2 text-right`}>{usd(o.priceCents)}</td>
                <td className={`${td} pr-2`}>{o.preference}</td>
                <td className={`${td} pr-2`}>not seated — {o.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
