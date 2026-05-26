// Pure function that runs an allocation and materializes the DB row
// shapes that should be written. Separated from the orchestration
// layer (run-preview.ts) so the placement+materialization logic stays
// unit-testable without any DB mocking.
//
// The GAE returns one SeatAssignment per (offer, seat) pair — a group
// of 4 produces 4 rows with the same offerId. The seat_assignments
// table stores one row per offer with seat_numbers as a text[]. This
// module does the regrouping and captures the row's `tier` (which the
// GAE doesn't put on the assignment — we look it up from the venue).

import { allocate } from "@/lib/gae";
import type {
  AllocationConfig,
  AllocationDecision,
  AllocationResult,
  VenueRow,
} from "@/lib/gae/types";

import type {
  VenueArchitecture as DbVenueArchitecture,
} from "@/lib/db/repositories";

import type { offers, shows } from "../../../drizzle/schema";

import {
  toGaeRankedOffer,
  toGaeVenueArchitecture,
} from "./translate";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

// What the DB-write layer needs to insert. Field names mirror the
// drizzle columns so the orchestration layer can `.insert(...).values(rows)`
// without a per-row remap.
export type AssignmentRow = {
  offerId: string;
  showId: string;
  venueRowId: string;
  seatNumbers: string[];
  tier: string;
  isBinding: boolean;
};

export type LogRow = {
  showId: string;
  action: AllocationDecision["action"];
  offerId: string | null;
  venueRowId: string | null;
  seatNumbers: string[] | null;
  reason: string;
  snapshot: Record<string, unknown>;
  mode: "preview" | "binding";
};

export type AllocationPlan = {
  result: AllocationResult;
  assignmentRows: AssignmentRow[];
  logRows: LogRow[];
};

// Maps the GAE's enum of actions to the schema's enum. They're
// identical for the actions the GAE currently emits — kept explicit so
// a future GAE action that doesn't match the schema (e.g. a new
// MERGE_GROUPS audit type) surfaces a TS error at this boundary
// instead of a quiet DB violation.
type GaeAction = AllocationDecision["action"];
function logAction(action: GaeAction): LogRow["action"] {
  return action;
}

// Group the GAE's per-seat assignments into one DB row per (offer,
// venueRow). The GAE always places a group together in one row (no
// split across rows for a single offer in the current spec), so a
// (offerId, venueRowId) tuple is enough to dedupe.
function groupAssignmentsByOffer(
  result: AllocationResult,
  show: Pick<Show, "id">,
  rowById: Map<string, VenueRow>,
  isBinding: boolean,
): AssignmentRow[] {
  type Bucket = {
    offerId: string;
    venueRowId: string;
    seatNumbers: string[];
    tier: string;
  };
  const buckets = new Map<string, Bucket>();

  for (const a of result.assignments) {
    // (offerId, venueRowId) is the natural key, but offerId alone is
    // already unique because a group never splits — use that.
    const key = a.offerId;
    let bucket = buckets.get(key);
    if (!bucket) {
      const row = rowById.get(a.venueRowId);
      bucket = {
        offerId: a.offerId,
        venueRowId: a.venueRowId,
        seatNumbers: [],
        // tier is captured at placement time per drizzle/schema.ts §8
        // ("Captured at placement so future tier renames don't
        // rewrite history"). The GAE doesn't expose tier on the
        // assignment; we look it up from the row. GA rows have no
        // tier field — fall back to "ga" to keep the column NOT NULL.
        tier: row?.tier ?? (row?.isGa ? "ga" : "unknown"),
      };
      buckets.set(key, bucket);
    }
    bucket.seatNumbers.push(a.seatNumber);
  }

  return Array.from(buckets.values()).map((b) => ({
    offerId: b.offerId,
    showId: show.id,
    venueRowId: b.venueRowId,
    seatNumbers: b.seatNumbers,
    tier: b.tier,
    isBinding,
  }));
}

function buildLogRows(
  result: AllocationResult,
  showId: string,
  mode: "preview" | "binding",
): LogRow[] {
  return result.decisions.map((d) => ({
    showId,
    action: logAction(d.action),
    offerId: d.offerId ?? null,
    venueRowId: d.venueRowId ?? null,
    // GAE decisions don't currently carry seat numbers on the
    // decision itself (the snapshot does). Keep the column nullable
    // and leave it null until the decision-level seat tracking
    // arrives.
    seatNumbers: null,
    reason: d.reason,
    snapshot: d.snapshot,
    mode,
  }));
}

// Build a complete preview allocation plan from already-loaded inputs.
// Pure — no DB, no env, no clock. Caller provides `now` if it wants
// to embed timestamps anywhere (currently we don't — both tables have
// default-now timestamp columns at the DB level).
export function buildPreviewAllocationPlan(
  show: Show,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
  config: AllocationConfig = {
    mode: "preview",
    allowOrphans: true,
    // shows.maxGroupSize defaults to 10 (ADR-0011) but per-show
    // overrides exist. Hand the show's value to the GAE so the
    // engine's group-size cap matches the schema constraint.
    maxGroupSize: 10,
    orphanPolicy: "leave",
  },
): AllocationPlan {
  const venue = toGaeVenueArchitecture(show, architecture);
  const rankedOffers = poolOffers.map(toGaeRankedOffer);
  const effectiveConfig: AllocationConfig = {
    ...config,
    maxGroupSize: show.maxGroupSize,
  };
  const result = allocate(venue, rankedOffers, effectiveConfig);

  const rowById = new Map<string, VenueRow>();
  for (const row of architecture.rows) {
    rowById.set(row.id, row);
  }

  return {
    result,
    assignmentRows: groupAssignmentsByOffer(result, show, rowById, false),
    logRows: buildLogRows(result, show.id, "preview"),
  };
}
