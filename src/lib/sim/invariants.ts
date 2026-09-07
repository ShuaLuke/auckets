// Invariants checked on every run (docs/GAE_SIMULATOR.md §4.7). A policy
// that breaks one is a bug, not a result — the report prints these in red
// and the CLI exits non-zero.

import type { AllocationResult, RankedOffer } from "@/lib/gae/types";

import { compatible } from "./metrics";
import type { InvariantViolation, SimVenue } from "./types";
import { activeRows, tierOrder } from "./venue";

export function checkInvariants(venue: SimVenue, offers: RankedOffer[], result: AllocationResult): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const rows = activeRows(venue);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const offerById = new Map(offers.map((o) => [o.id, o]));

  // 3. Double booking — seats and offers.
  const seatKeys = new Set<string>();
  for (const a of result.assignments) {
    const key = `${a.venueRowId}#${a.positionIndex}`;
    if (seatKeys.has(key)) out.push({ invariant: "double-booking", message: `seat ${a.venueRowId}:${a.seatNumber} assigned twice` });
    seatKeys.add(key);
  }
  const placedIds = new Set(result.assignments.map((a) => a.offerId));
  const unplacedIds = new Set<string>();
  for (const u of result.unplaced) {
    if (unplacedIds.has(u.offerId)) out.push({ invariant: "double-booking", message: `offer ${u.offerId} listed unplaced twice` });
    unplacedIds.add(u.offerId);
    if (placedIds.has(u.offerId)) out.push({ invariant: "double-booking", message: `offer ${u.offerId} is both placed and unplaced` });
  }
  for (const o of offers) {
    if (!placedIds.has(o.id) && !unplacedIds.has(o.id)) out.push({ invariant: "double-booking", message: `offer ${o.id} is neither placed nor unplaced` });
  }
  for (const id of placedIds) {
    if (!offerById.has(id)) out.push({ invariant: "double-booking", message: `assignment for unknown offer ${id}` });
  }

  // 1. Contiguity: one row, groupSize seats, consecutive positions, no holds.
  const byOffer = new Map<string, typeof result.assignments>();
  for (const a of result.assignments) {
    const list = byOffer.get(a.offerId) ?? [];
    list.push(a);
    byOffer.set(a.offerId, list);
  }
  for (const [offerId, list] of byOffer) {
    const o = offerById.get(offerId);
    if (!o) continue;
    const rowIds = new Set(list.map((a) => a.venueRowId));
    if (rowIds.size !== 1) {
      out.push({ invariant: "contiguity", message: `offer ${offerId} spans ${rowIds.size} rows` });
      continue;
    }
    const row = rowById.get(list[0]!.venueRowId);
    if (!row) {
      out.push({ invariant: "contiguity", message: `offer ${offerId} placed in inactive/unknown row ${list[0]!.venueRowId}` });
      continue;
    }
    if (list.length !== o.groupSize) {
      out.push({ invariant: "contiguity", message: `offer ${offerId} (group of ${o.groupSize}) got ${list.length} seats` });
    }
    const positions = list.map((a) => a.positionIndex).sort((x, y) => x - y);
    for (let i = 1; i < positions.length; i++) {
      if (positions[i]! !== positions[i - 1]! + 1) {
        out.push({ invariant: "contiguity", message: `offer ${offerId} seats are not adjacent in row ${row.id}` });
        break;
      }
    }
    const held = new Set(row.holds);
    for (const a of list) {
      if (row.seatNumbers[a.positionIndex] !== a.seatNumber) {
        out.push({ invariant: "contiguity", message: `offer ${offerId}: position ${a.positionIndex} is not seat ${a.seatNumber} in row ${row.id}` });
      }
      if (held.has(a.seatNumber)) out.push({ invariant: "contiguity", message: `offer ${offerId} seated on held seat ${row.id}:${a.seatNumber}` });
    }
  }

  // 2. Total accounting.
  const available = rows.reduce((s, r) => s + r.capacity - r.holds.length, 0);
  const st = result.stats;
  if (st.placedSeats + st.orphanSeats + st.unfilledSeats !== available) {
    out.push({
      invariant: "accounting",
      message: `placed ${st.placedSeats} + orphan ${st.orphanSeats} + unfilled ${st.unfilledSeats} ≠ available ${available}`,
    });
  }
  if (st.placedSeats !== result.assignments.length) {
    out.push({ invariant: "accounting", message: `stats.placedSeats ${st.placedSeats} ≠ assignments ${result.assignments.length}` });
  }

  // 4. No free upgrades.
  const tierIdx = new Map(tierOrder(venue).map((t, i) => [t, i]));
  for (const [offerId, list] of byOffer) {
    const o = offerById.get(offerId);
    const row = rowById.get(list[0]!.venueRowId);
    if (!o || !row) continue;
    if (!compatible(o.tierPreference, row, tierIdx)) {
      out.push({
        invariant: "no-free-upgrade",
        message: `offer ${offerId} (${JSON.stringify(o.tierPreference)}) seated in tier "${row.tier ?? "?"}"`,
      });
    }
  }

  return out;
}
