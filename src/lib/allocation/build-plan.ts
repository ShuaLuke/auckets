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

import { resolveAutoBids, type AutoBidRaise } from "./auto-bid";
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
  // Set only in binding mode: links the seat assignment to the auth
  // PaymentIntent that the binding run captures. Preview omits it (the
  // column defaults to null) — preview never touches money.
  stripePaymentIntentId?: string | null;
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
  // Auto-bid raises applied to reach this plan (ADR-0018). Populated in
  // both modes now. In preview they're ephemeral (a re-runnable projection,
  // surfaced for display + displacement alerts). In binding the orchestrator
  // persists each placed raise onto the offer + an offer_revisions row, and
  // captures the raised amount.
  autoBidRaises: AutoBidRaise[];
  // The settled pool the plan was built from — i.e. poolOffers with auto-bid
  // raises applied (price + rankKey). The binding orchestrator reads the
  // resolved price off these to compute each capture amount; preview carries
  // them for symmetry. Same ids/groupSize/Stripe refs as the input pool —
  // only price + rankKey differ for raised offers.
  resolvedOffers: readonly Offer[];
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
  // Present only in binding mode: offerId → auth PaymentIntent id. The
  // produced rows carry it so the binding orchestrator can capture each
  // placed offer's auth. Absent in preview (the key is omitted from the
  // row entirely, leaving the column at its null default).
  paymentIntentByOfferId?: Map<string, string | null>,
): AssignmentRow[] {
  type Bucket = {
    offerId: string;
    venueRowId: string;
    seatNumbers: string[];
    tier: string;
    stripePaymentIntentId: string | null | undefined;
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
        stripePaymentIntentId: paymentIntentByOfferId
          ? paymentIntentByOfferId.get(a.offerId) ?? null
          : undefined,
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
    // Omit the key entirely in preview (undefined) so the column keeps
    // its null default; include it (string | null) in binding.
    ...(b.stripePaymentIntentId !== undefined
      ? { stripePaymentIntentId: b.stripePaymentIntentId }
      : {}),
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

// Shared core for both preview and binding plans. Pure — no DB, no env,
// no clock. The only difference between the two modes at the plan level
// is the `mode`/`isBinding` flags stamped on the rows and, in binding,
// the per-offer auth PaymentIntent id carried onto each assignment row
// (so the orchestrator can capture it). Placements themselves are
// identical: the GAE is deterministic, which is exactly why a preview
// faithfully shows what binding will do.
// Build the GAE config for a show in a given mode. Shared so the auto-bid
// resolver (which runs the GAE itself) and the plan use identical config.
function makeConfig(show: Show, mode: "preview" | "binding"): AllocationConfig {
  return {
    mode,
    allowOrphans: true,
    orphanPolicy: "leave",
    // shows.maxGroupSize defaults to 10 (ADR-0011) but per-show
    // overrides exist. Hand the show's value to the GAE so the
    // engine's group-size cap matches the schema constraint.
    maxGroupSize: show.maxGroupSize,
  };
}

function buildAllocationPlan(
  show: Show,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
  mode: "preview" | "binding",
  autoBidRaises: AutoBidRaise[] = [],
): AllocationPlan {
  const venue = toGaeVenueArchitecture(show, architecture);
  const rankedOffers = poolOffers.map(toGaeRankedOffer);
  const effectiveConfig = makeConfig(show, mode);
  const result = allocate(venue, rankedOffers, effectiveConfig);

  const rowById = new Map<string, VenueRow>();
  for (const row of architecture.rows) {
    rowById.set(row.id, row);
  }

  const isBinding = mode === "binding";
  const paymentIntentByOfferId = isBinding
    ? new Map(poolOffers.map((o) => [o.id, o.stripePaymentIntentId]))
    : undefined;

  return {
    result,
    assignmentRows: groupAssignmentsByOffer(
      result,
      show,
      rowById,
      isBinding,
      paymentIntentByOfferId,
    ),
    logRows: buildLogRows(result, show.id, mode),
    autoBidRaises,
    // poolOffers here is already the auto-bid-settled pool (both builders
    // resolve before calling in).
    resolvedOffers: poolOffers,
  };
}

// Build a complete preview allocation plan from already-loaded inputs.
// Auto-bid is resolved first (ADR-0018): displaced auto-bidders climb in
// $5 steps to defend their preferred section, capped, then the plan is
// built from the settled pool. The raises are returned for display /
// future displacement alerts but are NOT persisted (preview is a
// re-runnable projection).
export function buildPreviewAllocationPlan(
  show: Show,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
): AllocationPlan {
  const { offers: resolved, raises } = resolveAutoBids(
    show,
    architecture,
    poolOffers,
    makeConfig(show, "preview"),
  );
  return buildAllocationPlan(show, architecture, resolved, "preview", raises);
}

// Build a complete binding allocation plan.
//
// Resolves auto-bids first, identically to preview (ADR-0018): displaced
// auto-bidders climb in $5 steps to defend their preferred section, capped,
// then the plan is built from the settled pool — so a fan defended in
// preview is also defended at binding. This is safe to charge because the
// submission path authorizes auto-bid offers up to their CAP (cap×groupSize),
// so the resolved price (≤ cap) is always within the held auth. The
// orchestrator (run-binding) persists each placed raise + captures the
// resolved amount; `autoBidRaises` carries the diff and `resolvedOffers` the
// settled prices.
export function buildBindingAllocationPlan(
  show: Show,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
): AllocationPlan {
  const { offers: resolved, raises } = resolveAutoBids(
    show,
    architecture,
    poolOffers,
    makeConfig(show, "binding"),
  );
  return buildAllocationPlan(show, architecture, resolved, "binding", raises);
}
