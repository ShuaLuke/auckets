// The venue and pool library as a static module, for the app. The CLI reads
// sim/venues/*.json from disk; the admin Simulation tab runs on Vercel, where
// the reliable way to ship data files is to import them, so each library
// entry is listed here. Adding a venue to sim/venues/ means adding a line.
//
// Pure: JSON imports and the existing parsers only.

import { computeRankKey } from "@/lib/gae/rankkey";
import type { RankedOffer, TierPreference } from "@/lib/gae/types";

import austinPartial from "../../../sim/venues/austin-partial.json";
import copesPlace from "../../../sim/venues/copes-place.json";
import leanDemo from "../../../sim/venues/lean-demo.json";
import lincolnManifest from "../../../sim/venues/lincoln-manifest.json";
import lincolnSynthetic from "../../../sim/venues/lincoln-synthetic.json";
import lincolnV4 from "../../../sim/venues/lincoln-v4.json";
import supperClub from "../../../sim/venues/supper-club.json";
import lincolnPoolV4 from "../../../sim/pools/lincoln-pool-v4.json";

import { SUBMITTED_BASE_MS } from "./pool";
import type { AutoBids, SimVenue } from "./types";
import { parseVenueFile, tierOrder, venueParitySummary } from "./venue";

const RAW_VENUES: unknown[] = [lincolnV4, lincolnManifest, copesPlace, supperClub, lincolnSynthetic, austinPartial, leanDemo];

let cache: SimVenue[] | undefined;

export function libraryVenues(): SimVenue[] {
  cache ??= RAW_VENUES.map((raw, i) => parseVenueFile(raw, `library[${i}]`));
  return cache;
}

export function libraryVenue(name: string): SimVenue | undefined {
  return libraryVenues().find((v) => v.name === name);
}

export type LibraryVenueSummary = {
  name: string;
  displayName: string;
  capacity: number;
  rows: number;
  tiers: string[];
  floorsCents: Record<string, number>;
  sections: string[];
  singleRows: number;
  notes: string | undefined;
};

export function libraryVenueSummaries(): LibraryVenueSummary[] {
  return libraryVenues().map((v) => {
    const s = venueParitySummary(v)[0]!;
    return {
      name: v.name,
      displayName: v.displayName,
      capacity: s.capacity,
      rows: s.activeRows,
      tiers: tierOrder(v),
      floorsCents: v.tierFloorsCents ?? {},
      sections: [...new Set(v.rows.map((r) => r.section))],
      singleRows: s.singleRows,
      notes: v.notes,
    };
  });
}

// --- pools -----------------------------------------------------------------

type PoolFile = {
  name: string;
  displayName: string;
  source: string;
  offers: { id: string; groupSize: number; pricePerTicketCents: number; tierPreference: TierPreference; order: number }[];
  autoBids: AutoBids;
};

const RAW_POOLS: PoolFile[] = [lincolnPoolV4 as PoolFile];

export type LibraryPoolSummary = { name: string; displayName: string; offers: number; tickets: number; source: string };

export function libraryPoolSummaries(): LibraryPoolSummary[] {
  return RAW_POOLS.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    offers: p.offers.length,
    tickets: p.offers.reduce((s, o) => s + o.groupSize, 0),
    source: p.source,
  }));
}

export function libraryPool(name: string): { offers: RankedOffer[]; autoBids: AutoBids } | undefined {
  const p = RAW_POOLS.find((x) => x.name === name);
  if (!p) return undefined;
  return {
    offers: p.offers.map((o) => ({
      id: o.id,
      userId: `user-${o.id}`,
      showId: "sim-show",
      groupSize: o.groupSize,
      pricePerTicketCents: o.pricePerTicketCents,
      rankKey: computeRankKey(o.pricePerTicketCents, o.groupSize),
      submittedAt: new Date(SUBMITTED_BASE_MS + o.order * 1000),
      tierPreference: o.tierPreference,
    })),
    autoBids: p.autoBids,
  };
}
