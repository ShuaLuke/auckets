// Orchestration for the BINDING allocation run — the irreversible,
// money-moving counterpart to run-preview.ts. This is where placed
// offers' card auths are captured (the fan is charged) and unplaced
// offers' auths are released.
//
// Why this is structured in two phases (and not one transaction like
// preview):
//
//   Phase 1 — decide & persist, with ZERO Stripe calls, in one DB
//   transaction. The transaction OPENS with the closed → 'allocating'
//   compare-and-set (step 2 of the gate below) — if that loses, the whole
//   transaction aborts with zero writes. Then the GAE result is
//   materialized into seat_assignments (is_binding=true) and offer.status
//   transitions (pool → placed / unplaced), the binding allocation_logs
//   are appended, and the per-fan displacement_events for this compute
//   (diffed against the last preview projection, ADR-0018 §4) are
//   written. Once this commits, the placement decision is durable.
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
  claimShowForBinding,
  getLatestRaiseTargetsByOfferForShow,
  getShowById,
  getVenueArchitectureById,
  listPoolOffersForShow,
  listSeatAssignmentsForShow,
  markShowAllocating,
} from "@/lib/db/repositories";
import {
  cancelOfferPaymentIntent,
  captureOfferPaymentIntent,
} from "@/lib/stripe/payment-intents";
import { logger } from "@/lib/logger";
import {
  notifyBindingOutcomes,
  type BindingOutcomeOffer,
} from "@/lib/notifications/fan";
import {
  allocationLogs,
  displacementEvents,
  offerRevisions,
  offers,
  seatAssignments,
  shows,
} from "../../../drizzle/schema";

import { buildBindingAllocationPlan, type AllocationPlan } from "./build-plan";
import { detectDisplacementEvents, type Placement } from "./displacement";

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
  // Per-fan displacement alerts emitted by diffing the final binding placement
  // against the fan's last preview projection (ADR-0018 §4).
  displacementEventsWritten: number;
};

export type RunBindingError =
  | { kind: "show_not_found"; showId: string }
  | { kind: "architecture_not_found"; architectureId: string }
  | { kind: "show_not_eligible"; status: string };

export type RunBindingOutcome =
  | { ok: true; value: RunBindingResult }
  | { ok: false; error: RunBindingError };

// Binding is one-shot and irreversible (it moves real money), so — unlike
// preview, which is freely re-runnable — it's gated by a two-step
// compare-and-set rather than a read-then-act status check (which two
// concurrent triggers, e.g. the admin Run-binding button and the 5-minute
// sweep, could both pass):
//
//   Step 1 (here, before ANY other read): claimShowForBinding CAS-es the
//   show 'open' → 'closed'. That atomically ends the offer window — POST
//   /api/offers is 'open'-only for submissions and revisions alike — so the
//   pool we read below can't gain or change members before Phase 1 commits.
//   An already-'closed' show (ops end-early, or a previous attempt that
//   crashed before Phase 1) passes too; every other status bounces:
//   'paused' (halt requested, ADR-0013 — ops decides when it binds),
//   'allocating' (a run's Phase 1 already committed — re-triggering would
//   risk double-capture), 'allocated' / 'complete' (done), 'draft' (no
//   offers).
//
//   Step 2 (first statement of the Phase-1 transaction): markShowAllocating
//   CAS-es 'closed' → 'allocating'. Exactly one concurrent caller can win
//   that row; a loser throws BindingClaimLost so its transaction aborts
//   with zero writes and the run reports show_not_eligible.
//
// Crash recovery falls out of the same shape: dying between step 1 and the
// Phase-1 commit leaves the show 'closed', which is still due for the
// scheduled sweep — the next tick simply retries. Dying after Phase 1
// leaves 'allocating', which no trigger will touch (Phase-2 resumability
// is a separate slice).
class BindingClaimLost extends Error {
  constructor() {
    super("binding claim lost: show was not 'closed' at Phase-1 CAS");
    this.name = "BindingClaimLost";
  }
}

export async function runBindingAllocation(
  db: Db,
  stripe: Stripe,
  showId: string,
): Promise<RunBindingOutcome> {
  // Step 1: claim the show (close the offer window) BEFORE reading anything.
  const claim = await claimShowForBinding(db, showId);
  if (!claim.ok) {
    if (claim.reason === "not_found") {
      return { ok: false, error: { kind: "show_not_found", showId } };
    }
    return {
      ok: false,
      error: { kind: "show_not_eligible", status: claim.status },
    };
  }

  const show = await getShowById(db, showId);
  if (!show) {
    // Deleted between the claim and this read; defensive.
    return { ok: false, error: { kind: "show_not_found", showId } };
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

  // ---- Displacement alerts (ADR-0018 §4) ----
  // Diff the FINAL binding placement against the fan's last PREVIEW projection
  // (the baseline they last saw) so the binding compute alerts on any
  // last-moment displacement. Read the baseline now — Phase 1 deletes the
  // preview rows. auto_bid_raise events already emitted at preview dedupe
  // against the persisted raise target, so the same raise isn't re-alerted.
  const priorAssignments = await listSeatAssignmentsForShow(db, showId);
  const prevByOffer = new Map<string, Placement>();
  for (const a of priorAssignments) {
    if (a.isBinding) continue; // baseline is the preview projection only
    prevByOffer.set(a.offerId, { tier: a.tier, venueRowId: a.venueRowId });
  }
  const newByOffer = new Map<string, Placement>();
  for (const r of plan.assignmentRows) {
    newByOffer.set(r.offerId, { tier: r.tier, venueRowId: r.venueRowId });
  }
  const lastRaiseToByOffer = await getLatestRaiseTargetsByOfferForShow(
    db,
    showId,
  );
  const floors = (show.tierFloorsCents ?? {}) as Record<string, number>;
  const displacementEventRows = detectDisplacementEvents({
    prevByOffer,
    newByOffer,
    autoBidRaises: plan.autoBidRaises,
    offers: plan.resolvedOffers,
    lastRaiseToByOffer,
    tierRank: (tier) => (tier ? floors[tier] ?? 0 : 0),
  });

  // ---- Phase 1: decide & persist atomically (no Stripe calls) ----
  try {
    await db.transaction(async (tx) => {
      // Step 2 of the gate, FIRST statement of the transaction: CAS
      // 'closed' → 'allocating'. This is the real lock — if a concurrent
      // run won the row (or ops moved the show) the conditional UPDATE
      // matches nothing and we abort the whole transaction with zero
      // writes, before any placement or offer-status mutation.
      const won = await markShowAllocating(tx, showId);
      if (!won) {
        throw new BindingClaimLost();
      }

      // Clear prior PREVIEW rows for this show. seat_assignments is
      // unique(offer_id), so a leftover is_binding=false row would collide
      // with this run's is_binding=true insert. Binding rows can't already
      // exist (the CAS above proves no prior run reached Phase 1).
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

      // Append the fan-facing displacement alerts for this binding compute,
      // in the same transaction as the placement that produced them.
      if (displacementEventRows.length > 0) {
        await tx.insert(displacementEvents).values(
          displacementEventRows.map((e) => ({
            showId,
            offerId: e.offerId,
            userId: e.userId,
            kind: e.kind,
            detail: e.detail,
          })),
        );
      }
    });
  } catch (err) {
    if (err instanceof BindingClaimLost) {
      // A concurrent run won the Phase-1 CAS, or ops moved the show between
      // our step-1 claim and the transaction. The aborted transaction wrote
      // nothing; report the standard ineligibility outcome with the show's
      // current status (most likely 'allocating' — the winner is mid-run —
      // or 'allocated' if it already finished).
      const rows = await db
        .select({ status: shows.status })
        .from(shows)
        .where(eq(shows.id, showId))
        .limit(1);
      return {
        ok: false,
        error: {
          kind: "show_not_eligible",
          status: rows[0]?.status ?? "unknown",
        },
      };
    }
    throw err;
  }

  // ---- Phase 2: move money (outside the transaction, per offer) ----
  let captured = 0;
  let cardFailures = 0;
  let cancelled = 0;
  // Collected for the post-run fan emails (placed / card-failure / not-placed).
  const placedCharged: BindingOutcomeOffer[] = [];
  const cardFailedFans: { userId: string }[] = [];

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

    if (charged) {
      captured++;
      placedCharged.push({
        userId: offer.userId,
        tier: row.tier,
        chargedAmountCents: amountCents,
      });
    } else {
      cardFailures++;
      cardFailedFans.push({ userId: offer.userId });
    }
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
  // Unconditional on purpose: only the Phase-1 CAS winner reaches this line,
  // and no other transition touches an 'allocating' show (pause needs 'open',
  // close needs 'open'/'paused', a rival binding run needs 'closed').
  await db
    .update(shows)
    .set({ status: "allocated" })
    .where(eq(shows.id, showId));

  // ---- Post-run: fan emails (best-effort, never fails the run) ----
  // Placed-and-charged → "you're in"; placed-but-card-failed → "add a card";
  // unplaced → "not placed, nothing charged". sendEmail no-ops without
  // RESEND_API_KEY, so this is safe in dev/CI. Wrapped so an email/DB hiccup
  // can't undo a completed allocation.
  try {
    await notifyBindingOutcomes(db, {
      ctx: {
        showId,
        artistName: show.artist.name,
        showName: show.venue.name,
        doorsAt: show.doorsAt,
      },
      placed: placedCharged,
      cardFailed: cardFailedFans,
      unplaced: unplacedOffers.map((o) => ({ userId: o.userId })),
    });
  } catch (err) {
    logger.error(
      { event: "binding.notify.failed", showId, err },
      "Binding fan-notification dispatch failed (run already complete)",
    );
  }

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
      displacementEventsWritten: displacementEventRows.length,
    },
  };
}
