// Small builders shared by the sim tests. Not exported from index.ts.
import { computeRankKey } from "@/lib/gae/rankkey";
import type { RankedOffer, TierPreference, VenueRow } from "@/lib/gae/types";

import type { SimVenue } from "./types";

export function row(spec: {
  id: string;
  rank: number;
  cap: number;
  tier: string;
  area?: string;
  section?: string;
  lean?: VenueRow["lean"];
  holds?: string[];
  isGa?: boolean;
}): VenueRow {
  return {
    id: spec.id,
    area: spec.area ?? "orchestra",
    section: spec.section ?? "center",
    rowName: spec.id.toUpperCase(),
    rowRank: spec.rank,
    capacity: spec.cap,
    parity: spec.cap % 2 === 0 ? "EVEN" : "ODD",
    lean: spec.lean ?? "LEFT",
    seatNumbers: Array.from({ length: spec.cap }, (_, i) => String(i + 1)),
    holds: spec.holds ?? [],
    tier: spec.tier,
    ...(spec.isGa !== undefined && { isGa: spec.isGa }),
  };
}

export function venue(rows: VenueRow[], extra: Partial<SimVenue> = {}): SimVenue {
  return {
    name: "test-venue",
    displayName: "Test venue",
    venueId: "test-venue",
    rows,
    activeRowIds: rows.map((r) => r.id),
    tierFloorsCents: { premium: 10000, mid: 6000, rear: 4000 },
    ...extra,
  };
}

export function offer(id: string, groupSize: number, priceCents: number, pref: TierPreference = { type: "any" }, order = 0): RankedOffer {
  return {
    id,
    userId: `u-${id}`,
    showId: "s",
    groupSize,
    pricePerTicketCents: priceCents,
    rankKey: computeRankKey(priceCents, groupSize),
    submittedAt: new Date(Date.UTC(2026, 0, 1) + order * 1000),
    tierPreference: pref,
  };
}
