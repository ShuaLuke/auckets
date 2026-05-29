// Orchestration for the BINDING allocation run — the irreversible,
// money-moving counterpart to run-preview.ts. This is where placed
// offers' card auths are captured (the fan is charged) and unplaced
// offers' auths are released.
//
// Why this is structured in two phases (and not one transaction like
// preview):
//
//   Phase 1 — decide & persist, with ZERO Stripe calls, in one DB
//   transaction. The GAE result is materialized into seat_assignments
//   (is_binding=true) and offer.status transitions (pool → placed /
//   unplaced), the show is flipped to 'allocating', and the binding
//   allocation_logs are appended. Once this commits, the placement
//   decision is durable.
//
//   Phase 2 — move money, OUTSIDE the transaction, per offer. Stripe is
//   network I/O that can take seconds and partially fail; you can't hold
//   a Postgres transaction open across N captures, and — worse — a
//   capture that succeeds while the surrounding tx rolls back would
//   charge a fan with no record of it. So each offer's capture/cancel
//   and its resulting terminal write (charged / card_failure) is its own
//   small transaction. A crash mid-phase leaves a recoverable state
//   rather than a dual-write inconsistency.
//
//   Phase 3 — flip the show to 'allocated'.
//
// Capture failures (the ~2% card-failure case from ADR-0003: card
// canceled between auth and capture) are recorded as offer.status
// 'card_failure' + seat_assignments.card_failure_at; they do NOT abort
// the run. The downstream card-failure recovery flow is a later slice.

import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  getShowById,
  getVenueArchitectureById,
  listPoolOffersForShow,
} from "@/lib/db/repositories";
import {
  cancelOfferPaymentIntent,
  captureOfferPaymentIntent,
} from "@/lib/stripe/payment-intents";
import { logger } from "@/lib/logger";
import {
  allocationLogs,
  offerRevisions,
  offers,
  seatAssignments,
  shows,
} from "../../../drizzle/schema";

import { buildBindingAllocationPlan, type AllocationPlan } from "./build-plan";

export type RunBindingResult = {
  showId: string;
  mode: "binding";
  ranAt: Date;
  stats: AllocationPlan["result"]["stats"];
  assignmentsWritten: number;
  logsWritten: number;
  // Placed offers whose auth was captured successfully (fan charged).
  captured: number;
  // Placed offers whose capture failed → flagged card_failure.
  cardFailures: number;
  // Unplaced offers whose auth was released.
  cancelled: number;
  // Placed offers whose price was auto-raised at binding (ADR-0018) — the
  // raise was persisted onto the offer + an offer_revisions row, and the
  // raised amount was the one captured.
  autoRaised: number;
};

export type RunBindingError =
  | { kind: "show_not_found"; showId: string }
  | { kind: "architecture_not_found"; architectureId: string }
  | { kind: "show_not_eligible"; status: string };

export type RunBindingOutcome =
  | { ok: true; value: RunBindingResult }
  | { ok: false; error: RunBindingError };

// Binding is one-shot and irreversible (it moves real money), so — unlike
// preview, which is freely re-runnable — it's only eligible from the
// pre-binding statuses where the offer pool is still the source of truth.
// 'allocating' is excluded on purpose: it means a binding run is already
// in progress (Phase 1 committed), so a re-trigger must bounce rather than
// risk double-capturing. 'allocated' / 'complete' are done; 'paused' means
// a halt was requested (ADR-0013); 'draft' has no offers.
const BINDING_ELIGIBLE_STATUSES = new Set(["open", "closed"]);

export async function runBindingAllocation(
  db: Db,
  stripe: Stripe,
  showId: string,
): Promise<RunBindingOutcome> {
  const show = await getShowById(db, showId);
  if (!show) {
    return { ok: false, error: { kind: "show_not_found", showId } };
  }
  if (!BINDING_ELIGIBLE_STATUSES.has(show.status)) {
    return {
      ok: false,
      error: { kind: "show_not_eligible", status: show.status },
    };
  }

  const architecture = await getVenueArchitectureById(
    db,
    show.venueArchitectureId,
  );
  if (!architecture) {
    return {
      ok: false,
      error: {
        kind: "architecture_not_found",
        architectureId: show.venueArchitectureId,
      },
    };
  }

  const poolOffers = await listPoolOffersForShow(db, showId);
  const plan = buildBindingAllocationPlan(show, architecture, poolOffers);

  const placedOfferIds = plan.assignmentRows.map((r) => r.offerId);
  const placedSet = new Set(placedOfferIds);
  const unplacedOffers = poolOffers.filter((o) => !placedSet.has(o.id));

  // The auto-bid-settled pool the plan was built from. Capture amounts and
  // the raise persistence below read the RESOLVED price off these (≤ the
  // offer's cap, which is what we authorized at submission).
  const resolvedOfferById = new Map(plan.resolvedOffers.map((o) => [o.id, o]));

  // Only persist raises for offers that actually ENDED placed: an auto-bidder
  // that climbed to its cap and still didn't hold a seat is unplaced, pays
  // nothing, and its submitted price stands. Recording a raise there would
  // claim a price change the fan was never charged for.
  const placedRaises = plan.autoBidRaises.filter((r) => placedSet.has(r.offerId));

  // ---- Phase 1: decide & persist atomically (no Stripe calls) ----
  await db.transaction(async (tx) => {
    // Lock in the run so a concurrent or duplicate trigger sees status
    // 'allocating' and bails out via the eligibility gate.
    await tx
      .update(shows)
      .set({ status: "allocating" })
      .where(eq(shows.id, showId));

    // Clear prior PREVIEW rows for this show. seat_assignments is
    // unique(offer_id), so a leftover is_binding=false row would collide
    // with this run's is_binding=true insert. Binding rows can't already
    // exist (we gated on a not-yet-allocating status).
    await tx
      .delete(seatAssignments)
      .where(
        and(
          eq(seatAssignments.showId, showId),
          eq(seatAssignments.isBinding, false),
        ),
      );
    if (plan.assignmentRows.length > 0) {
      await tx.insert(seatAssignments).values(plan.assignmentRows);
    }
    // allocation_logs is append-only history — preview logs stay; binding
    // logs (mode='binding') are added alongside.
    if (plan.logRows.length > 0) {
      await tx.insert(allocationLogs).values(plan.logRows);
    }
    if (placedOfferIds.length > 0) {
      await tx
        .update(offers)
        .set({ status: "placed" })
        .where(inArray(offers.id, placedOfferIds));
    }
    if (unplacedOffers.length > 0) {
      await tx
        .update(offers)
        .set({ status: "unplaced" })
        .where(
          inArray(
            offers.id,
            unplacedOffers.map((o) => o.id),
          ),
        );
    }

    // Persist auto-bid raises for placed offers (ADR-0018): the offer-of-
    // record's price + rankKey become the resolved amount, and an
    // offer_revisions row captures the change so /my-bids and the activity
    // feed show the raise — and so the charged amount matches the offer. The
    // append-only revisions snapshot mirrors upsertOfferForUser's shape.
    for (const raise of placedRaises) {
      const resolved = resolvedOfferById.get(raise.offerId);
      if (!resolved) continue; // derived from the plan; defensive
      // rank_key is a GENERATED STORED column (price*1000 + group_size), so
      // Postgres recomputes it from the new price — we never set it directly.
      await tx
        .update(offers)
        .set({
          pricePerTicketCents: resolved.pricePerTicketCents,
          revisedAt: new Date(),
        })
        .where(eq(offers.id, raise.offerId));
      await tx.insert(offerRevisions).values({
        offerId: raise.offerId,
        snapshot: {
          groupSize: resolved.groupSize,
          pricePerTicketCents: resolved.pricePerTicketCents,
          tierPreference: resolved.tierPreference,
          preferredTier: resolved.preferredTier,
          channel: resolved.channel,
          autoBidEnabled: resolved.autoBidEnabled,
          autoBidCapCents: resolved.autoBidCapCents,
          autoBidIncrementCents: resolved.autoBidIncrementCents,
          privateThresholdCents: resolved.privateThresholdCents,
          // Post-write state: this offer is being placed by this run.
          status: "placed",
          stripePaymentMethodId: resolved.stripePaymentMethodId,
          stripeSetupIntentId: resolved.stripeSetupIntentId,
          stripePaymentIntentId: resolved.stripePaymentIntentId,
          // Mark the provenance so the activity feed can label it an
          // auto-bid raise rather than a fan-initiated revision.
          autoBidRaise: { fromCents: raise.fromCents, toCents: raise.toCents, steps: raise.steps },
        },
      });
    }
  });

  // ---- Phase 2: move money (outside the transaction, per offer) ----
  let captured = 0;
  let cardFailures = 0;
  let cancelled = 0;

  // Source placed offers from the RESOLVED pool so the capture amount is the
  // auto-raised price (when raised) — always ≤ the cap we authorized.
  for (const row of plan.assignmentRows) {
    const offer = resolvedOfferById.get(row.offerId);
    if (!offer) continue; // plan rows derive from the resolved pool; defensive
    const amountCents = offer.pricePerTicketCents * offer.groupSize;

    let charged = false;
    if (offer.stripePaymentIntentId) {
      const res = await captureOfferPaymentIntent(
        stripe,
        offer.stripePaymentIntentId,
        amountCents,
      );
      charged = res.ok;
      if (!res.ok) {
        logger.warn(
          { offerId: offer.id, showId, code: res.code },
          "Binding capture failed — flagging card_failure",
        );
      }
    } else {
      // No auth to capture. Under the ADR-0003 working assumption
      // (≤6-day windows) every offer carries a PaymentIntent; a missing
      // one means a SetupIntent-fallback or legacy stub offer we can't
      // charge here. Flag it for the card-failure recovery flow.
      logger.warn(
        { offerId: offer.id, showId },
        "Placed offer has no PaymentIntent to capture — flagging card_failure",
      );
    }

    await db.transaction(async (tx) => {
      if (charged) {
        await tx
          .update(offers)
          .set({ status: "charged" })
          .where(eq(offers.id, offer.id));
        await tx
          .update(seatAssignments)
          .set({ chargedAmountCents: amountCents })
          .where(eq(seatAssignments.offerId, offer.id));
      } else {
        await tx
          .update(offers)
          .set({ status: "card_failure" })
          .where(eq(offers.id, offer.id));
        await tx
          .update(seatAssignments)
          .set({ cardFailureAt: new Date() })
          .where(eq(seatAssignments.offerId, offer.id));
      }
    });

    if (charged) captured++;
    else cardFailures++;
  }

  // Release the auths on unplaced offers — the fan pays nothing.
  for (const offer of unplacedOffers) {
    if (!offer.stripePaymentIntentId) continue;
    const res = await cancelOfferPaymentIntent(
      stripe,
      offer.stripePaymentIntentId,
    );
    if (res.ok) {
      cancelled++;
    } else {
      // A failed cancel just means the auth lingers until it lapses on
      // its own (~7 days). Not worth failing the run; log for ops.
      logger.warn(
        { offerId: offer.id, showId, code: res.code },
        "Failed to cancel unplaced offer's auth — it will lapse on its own",
      );
    }
  }

  // ---- Phase 3: run complete ----
  await db
    .update(shows)
    .set({ status: "allocated" })
    .where(eq(shows.id, showId));

  return {
    ok: true,
    value: {
      showId,
      mode: "binding",
      ranAt: new Date(),
      stats: plan.result.stats,
      assignmentsWritten: plan.assignmentRows.length,
      logsWritten: plan.logRows.length,
      captured,
      cardFailures,
      cancelled,
      autoRaised: placedRaises.length,
    },
  };
}
