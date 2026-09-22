// "How this room fills" — the engine's rules for one venue, in the plain
// sentences a venue manager or an artist's team can follow next to the
// empty room. Everything here is what the shipped engine does today
// (docs/GAE_SPEC.md); where a rule is still an open question it says so
// rather than reading as settled.

import { usd } from "@/lib/sim/format";
import type { RoomRules } from "@/lib/sim/seatmap";

const n = (v: number): string => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`): string => `${n(v)} ${v === 1 ? one : many}`;
const pretty = (s: string): string => s.replace(/_/g, " ");

export function SimulationRoomRules({ rules }: { rules: RoomRules }) {
  const seatedRows = rules.leans.CENTER + rules.leans.LEFT + rules.leans.RIGHT + rules.leans.DUAL_AISLE;
  const leanParts = [
    rules.leans.CENTER > 0 && `${plural(rules.leans.CENTER, "row")} fill from the middle out — the best group in a row sits in the centre, the next to its left, the next to its right`,
    rules.leans.LEFT + rules.leans.RIGHT > 0 && `${plural(rules.leans.LEFT + rules.leans.RIGHT, "side row")} fill toward the centre aisle — the best group in the row sits nearest the middle of the house`,
    rules.leans.DUAL_AISLE > 0 && `${plural(rules.leans.DUAL_AISLE, "row")} fill from both aisles inward`,
  ].filter((x): x is string => typeof x === "string");

  return (
    <div className="font-sans text-[13px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
      <ol className="list-decimal space-y-2.5 pl-5">
        <li>
          <strong style={{ color: "var(--fg)" }}>Every row has a rank.</strong> {n(rules.rows)} rows on sale, ranked #{n(rules.bestRank)} (best) to #{n(rules.worstRank)}. The venue sets this order; the engine never changes it.
          {rules.tiers.length > 1 && (
            <>
              {" "}
              Tiers, best first: {rules.tiers.map((t) => `${pretty(t.name)} (${plural(t.rows, "row")}, ${n(t.seats)} seats${t.floorCents !== undefined ? `, floor ${usd(t.floorCents)}` : ""})`).join("; ")}.
            </>
          )}
        </li>
        <li>
          <strong style={{ color: "var(--fg)" }}>Every offer has a rank.</strong> Price per ticket first, then a larger group ahead of a smaller one at the same price, then whoever offered first. The top-ranked offer takes the best row it fits in, then the next offer, and so on down — a fan never sits behind someone who offered less.
        </li>
        <li>
          <strong style={{ color: "var(--fg)" }}>Groups stay together.</strong> A group takes seats side by side in one row. If a group doesn&apos;t fit in the next row with space, it takes the next row it does fit in; nobody is split up and nobody jumps the queue.
        </li>
        {seatedRows > 0 && (
          <li>
            <strong style={{ color: "var(--fg)" }}>Within a row, the best seats go first.</strong> {leanParts.join(". ")}. Hover any seat on the map to see where it comes in its row.
          </li>
        )}
        <li>
          <strong style={{ color: "var(--fg)" }}>Odd and even rows.</strong> {plural(rules.evenRows, "row")} have an even number of seats on sale, {n(rules.oddRows)} odd
          {rules.singleRows > 0 ? `, and ${plural(rules.singleRows, "row")} ${rules.singleRows === 1 ? "is" : "are"} a single seat` : ""}. Because groups are never split, a row&apos;s last odd seat can only go to a single or an odd-sized group. Today the engine does not steer odd groups toward odd rows; whether it should is still an open question (Q2), so an odd leftover shows up on the map as one empty seat.
        </li>
        {(rules.heldSeats > 0 || rules.gaSeats > 0 || rules.unitRows > 0) && (
          <li>
            <strong style={{ color: "var(--fg)" }}>Not every seat is a seat.</strong>
            {rules.heldSeats > 0 && <> {n(rules.heldSeats)} held and off sale ({rules.holds.map((h) => `${h.label} ${n(h.seats)}`).join(", ")}); a group never sits across a held seat.</>}
            {rules.gaSeats > 0 && <> {n(rules.gaSeats)} general-admission places have no assigned seat, so lean and row shape don&apos;t apply there.</>}
            {rules.unitRows > 0 && <> {plural(rules.unitRows, "table or box", "tables and boxes")} are filled seat by seat like a row unless the run protects them (one group per unit).</>}
          </li>
        )}
      </ol>
    </div>
  );
}
