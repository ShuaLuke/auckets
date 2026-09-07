// Venue library core: validate a venue file, build one from a tier spec,
// apply a per-show overlay (active sections, holds by source, floors, cap),
// and summarise the room the way Cope's "Architecture Summary" sheet does.
// Pure — the CLI does the file I/O.

import type { VenueArchitecture, VenueRow } from "@/lib/gae/types";
import { generateArchitectureRows, type TierSpec } from "@/lib/venues/generate-architecture";

import { formatIssues, TierSpecFileSchema, VenueFileSchema } from "./schema";
import type { HoldSource, ShowOverlay, SimVenue, VenueParitySummary } from "./types";

export class SimInputError extends Error {}

export function parseVenueFile(raw: unknown, label = "venue"): SimVenue {
  const parsed = VenueFileSchema.safeParse(raw);
  if (!parsed.success) throw new SimInputError(formatIssues(label, parsed.error));
  const v = parsed.data;
  const ids = new Set<string>();
  for (const [i, row] of v.rows.entries()) {
    if (ids.has(row.id)) throw new SimInputError(`${label}: rows[${i}] duplicate row id "${row.id}"`);
    ids.add(row.id);
    if (row.seatNumbers.length !== row.capacity) {
      throw new SimInputError(
        `${label}: rows[${i}] "${row.id}" has capacity ${row.capacity} but ${row.seatNumbers.length} seat numbers`,
      );
    }
    if (new Set(row.seatNumbers).size !== row.seatNumbers.length) {
      throw new SimInputError(`${label}: rows[${i}] "${row.id}" has duplicate seat numbers`);
    }
    for (const h of row.holds) {
      if (!row.seatNumbers.includes(h)) {
        throw new SimInputError(`${label}: rows[${i}] "${row.id}" holds seat "${h}" which is not in seatNumbers`);
      }
    }
  }
  const activeRowIds = v.activeRowIds ?? v.rows.map((r) => r.id);
  for (const id of activeRowIds) {
    if (!ids.has(id)) throw new SimInputError(`${label}: activeRowIds names unknown row "${id}"`);
  }
  const venue: SimVenue = {
    name: v.name,
    displayName: v.displayName,
    venueId: v.venueId,
    rows: v.rows as VenueRow[],
    activeRowIds,
  };
  if (v.tierFloorsCents) venue.tierFloorsCents = v.tierFloorsCents;
  if (v.relief) venue.relief = v.relief;
  if (v.notes) venue.notes = v.notes;
  if (v.source) venue.source = v.source;
  return venue;
}

// The "tier spec" upload: rows × seats per tier, same shape the inline venue
// builder uses in ShowCreate. Produces a uniform room.
export function venueFromTierSpec(raw: unknown, label = "tier spec"): SimVenue {
  const parsed = TierSpecFileSchema.safeParse(raw);
  if (!parsed.success) throw new SimInputError(formatIssues(label, parsed.error));
  const spec = parsed.data;
  const tiers: TierSpec[] = spec.tiers.map((t) => ({
    name: t.name,
    rowCount: t.rowCount,
    seatsPerRow: t.seatsPerRow,
    isGa: t.isGa ?? t.unitType === "ga",
    unitType: t.unitType,
    customLabel: t.customLabel,
  }));
  const rows = generateArchitectureRows(tiers);
  const floors: Record<string, number> = {};
  for (const t of spec.tiers) if (t.floorCents !== undefined) floors[t.name] = t.floorCents;
  const venue: SimVenue = {
    name: spec.name,
    displayName: spec.displayName,
    venueId: spec.name,
    rows,
    activeRowIds: rows.map((r) => r.id),
    source: { kind: "tier-spec" },
  };
  if (Object.keys(floors).length > 0) venue.tierFloorsCents = floors;
  if (spec.notes) venue.notes = spec.notes;
  return venue;
}

export function activeRows(venue: Pick<SimVenue, "rows" | "activeRowIds">): VenueRow[] {
  const active = new Set(venue.activeRowIds);
  return venue.rows.filter((r) => active.has(r.id)).sort((a, b) => a.rowRank - b.rowRank);
}

// Tier order, best first — the same inference the engine's waterfall uses
// (min rowRank of any ACTIVE row in the tier, ties by name), so the report
// and the engine never disagree about which tier is "better".
export function tierOrder(venue: Pick<SimVenue, "rows" | "activeRowIds">): string[] {
  const minRank = new Map<string, number>();
  for (const row of activeRows(venue)) {
    if (row.tier === undefined) continue;
    const prev = minRank.get(row.tier);
    if (prev === undefined || row.rowRank < prev) minRank.set(row.tier, row.rowRank);
  }
  return [...minRank.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([tier]) => tier);
}

export function toArchitecture(venue: SimVenue): VenueArchitecture {
  return { venueId: venue.venueId, rows: venue.rows, activeRowIds: venue.activeRowIds };
}

export type ResolvedShow = {
  venue: SimVenue; // holds merged, activeRowIds narrowed
  heldBySource: Record<HoldSource, number>;
  floorsCents: Record<string, number>;
  maxGroupSize: number;
  bleacher?: { seats: number; rows: number; priceCents: number; rowIds: string[] };
};

export function applyShowOverlay(base: SimVenue, overlay: ShowOverlay | undefined): ResolvedShow {
  const heldBySource: Record<HoldSource, number> = { venue: 0, artist: 0, comp: 0, production: 0, bleacher: 0 };
  const o = overlay ?? {};

  // 1. Active rows: explicit ids win; else sections/areas; else the venue's.
  let activeRowIds = base.activeRowIds;
  if (o.activeRowIds) {
    for (const id of o.activeRowIds) {
      if (!base.rows.some((r) => r.id === id)) throw new SimInputError(`show.activeRowIds: unknown row "${id}"`);
    }
    activeRowIds = o.activeRowIds;
  } else if (o.activeSections) {
    const wanted = new Set(o.activeSections.map((s) => s.toLowerCase()));
    const matched = base.rows.filter(
      (r) => wanted.has(r.section.toLowerCase()) || wanted.has(String(r.area).toLowerCase()),
    );
    if (matched.length === 0) {
      const known = [...new Set(base.rows.flatMap((r) => [r.section, String(r.area)]))].sort();
      throw new SimInputError(
        `show.activeSections matched no rows. Known sections/areas: ${known.join(", ")}`,
      );
    }
    activeRowIds = matched.map((r) => r.id);
  }

  // 2. Holds. Work on copies so the library venue is never mutated.
  const rows = base.rows.map((r) => ({ ...r, holds: [...r.holds] }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const activeSet = new Set(activeRowIds);
  for (const h of o.holds ?? []) {
    if (h.seatIds) {
      for (const seatId of h.seatIds) {
        const sep = seatId.lastIndexOf(":");
        const rowId = seatId.slice(0, sep);
        const seat = seatId.slice(sep + 1);
        const row = byId.get(rowId);
        if (!row) throw new SimInputError(`show.holds: unknown row in seat id "${seatId}"`);
        if (!row.seatNumbers.includes(seat)) throw new SimInputError(`show.holds: row "${rowId}" has no seat "${seat}"`);
        if (row.holds.includes(seat)) continue; // already held by the venue: not double-counted
        row.holds.push(seat);
        heldBySource[h.source] += 1;
      }
    } else if (h.tier !== undefined && h.seats !== undefined) {
      // Best rows first, from the row's first seat. Skips seats already held.
      let remaining = h.seats;
      const tierRows = rows
        .filter((r) => r.tier === h.tier && activeSet.has(r.id) && r.isGa !== true)
        .sort((a, b) => a.rowRank - b.rowRank);
      if (tierRows.length === 0) throw new SimInputError(`show.holds: no active seated rows in tier "${h.tier}"`);
      for (const row of tierRows) {
        for (const seat of row.seatNumbers) {
          if (remaining === 0) break;
          if (row.holds.includes(seat)) continue;
          row.holds.push(seat);
          heldBySource[h.source] += 1;
          remaining -= 1;
        }
        if (remaining === 0) break;
      }
      if (remaining > 0) {
        throw new SimInputError(`show.holds: tier "${h.tier}" has only ${h.seats - remaining} free seats to hold, asked for ${h.seats}`);
      }
    }
  }

  // 3. Bleacher carve-out (NEW-8, unconfirmed): whole seated rows from the
  // worst rowRank up until the share is met, held with source "bleacher".
  let bleacher: ResolvedShow["bleacher"];
  if (o.bleacher) {
    const onSale = rows.filter((r) => activeSet.has(r.id)).reduce((s, r) => s + r.capacity - r.holds.length, 0);
    const target = Math.round((o.bleacher.sharePct / 100) * onSale);
    const worstFirst = rows.filter((r) => activeSet.has(r.id) && r.isGa !== true).sort((a, b) => b.rowRank - a.rowRank);
    let seats = 0;
    const rowIds: string[] = [];
    for (const row of worstFirst) {
      if (seats >= target) break;
      const free = row.seatNumbers.filter((seat) => !row.holds.includes(seat));
      if (free.length === 0) continue;
      row.holds.push(...free);
      seats += free.length;
      heldBySource.bleacher += free.length;
      rowIds.push(row.id);
    }
    if (seats === 0) throw new SimInputError("show.bleacher: no seated rows available to carve out");
    bleacher = { seats, rows: rowIds.length, priceCents: o.bleacher.priceCents, rowIds };
  }

  const venue: SimVenue = { ...base, rows, activeRowIds };
  const resolved: ResolvedShow = {
    venue,
    heldBySource,
    floorsCents: { ...(base.tierFloorsCents ?? {}), ...(o.floorsCents ?? {}) },
    maxGroupSize: o.maxGroupSize ?? 10,
  };
  if (bleacher) resolved.bleacher = bleacher;
  return resolved;
}

// Cope's "Architecture Summary": one line for the whole room, one per area.
export function venueParitySummary(venue: SimVenue): VenueParitySummary[] {
  const active = new Set(venue.activeRowIds);
  const make = (scope: string, rows: VenueRow[]): VenueParitySummary => {
    const act = rows.filter((r) => active.has(r.id));
    const seated = act.filter((r) => r.isGa !== true);
    return {
      scope,
      capacity: act.reduce((s, r) => s + r.capacity - r.holds.length, 0),
      rows: rows.length,
      activeRows: act.length,
      evenRows: seated.filter((r) => (r.capacity - r.holds.length) % 2 === 0).length,
      oddRows: seated.filter((r) => (r.capacity - r.holds.length) % 2 === 1).length,
      singleRows: seated.filter((r) => r.capacity - r.holds.length === 1).length,
      pairRows: seated.filter((r) => r.capacity - r.holds.length === 2).length,
      reliefFlaggedRows: act.filter((r) => {
        const f = venue.relief?.[r.id];
        return f !== undefined && (f.single === true || f.gapRelief === true);
      }).length,
      heldSeats: act.reduce((s, r) => s + r.holds.length, 0),
      gaSeats: act.filter((r) => r.isGa === true).reduce((s, r) => s + r.capacity - r.holds.length, 0),
    };
  };
  const areas = [...new Set(venue.rows.map((r) => String(r.area)))];
  return [make("Full venue", venue.rows), ...areas.map((a) => make(a, venue.rows.filter((r) => String(r.area) === a)))];
}

// The largest group that could ever sit in this row (its longest unheld run).
export function maxRunLength(row: VenueRow): number {
  const held = new Set(row.holds);
  let best = 0;
  let cur = 0;
  for (const s of row.seatNumbers) {
    if (held.has(s)) {
      cur = 0;
    } else {
      cur += 1;
      if (cur > best) best = cur;
    }
  }
  return best;
}
