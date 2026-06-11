// Orchestration for the BINDING allocation run — the irreversible,
// money-moving counterpart to run-preview.ts. This is where placed
// offers' card auths are captured (the fan is charged) and unplaced
// offers' auths are released.
//
// Why this is structured in phases (and not one transaction like preview):
//
//   Phase 1 (runBindingPhase1) — decide & persist, with ZERO Stripe calls,
//   in one DB transaction. The transaction OPENS with the closed →
//   'allocating' compare-and-set (step 2 of the gate below) — if that
//   loses, the whole transaction aborts with zero writes. Then the GAE
//   result is materialized into seat_assignments (is_binding=true) and
//   offer.status transitions (pool → placed / unplaced), the binding
//   allocation_logs are appended, and the per-fan displacement_events for
//   this compute (diffed against the last preview projection, ADR-0018 §4)
//   are written. Once this commits, the placement decision is durable —
//   and, crucially, it is the COMPLETE input to Phase 2: every later phase
//   derives its work list from the DB, never from memory.
//
//   Phase 2 (captureBindingOffers / cancelUnplacedAuths) — move money,
//   OUTSIDE the transaction, per offer. Stripe is network I/O that can
//   take seconds and partially fail; you can't hold a Postgres transaction
//   open across N captures, and — worse — a capture that succeeds while
//   the surrounding tx rolls back would charge a fan with no record of it.
//   So each offer's capture/cancel and its resulting terminal write
//   (charged / card_failure) is its own small transaction.
//
//   Phase 3 (finalizeBinding) — CAS the show 'allocating' → 'allocated'
//   and send the outcome emails.
//
// Phases 2–3 are RE-ENTRANT. A crash mid-capture (Vercel timeout, deploy,
// OOM, Stripe outage) leaves the show in 'allocating' with a mix of
// terminal ('charged' / 'card_failure') and still-'placed' offers. Resume
// (resumeBindingAllocation, or the scheduled sweep's stuck-show recovery)
// rebuilds the remaining work from offer statuses:
//   - 'placed'  → still needs capture. The capture carries a deterministic
//     Stripe idempotency key (capture:<offerId>:<piId>) and treats an
//     already-'succeeded' PI as captured, so the ambiguous crash window
//     (charged at Stripe, terminal write lost) converges to 'charged'
//     without a double charge.
//   - 'charged' / 'card_failure' → already settled; skipped.
//   - 'unplaced' → re-cancel the auth; cancel is idempotent-soft (a PI
//     that's already canceled counts as success).
// The 'allocated' flip is a CAS, so exactly one finisher sends the emails.
//
// Capture failures (the ~2% card-failure case from ADR-0003: card
// canceled between auth and capture) are recorded as offer.status
// 'card_failure' + seat_assignments.card_failure_at; they do NOT abort
// the run. The downstream recovery flow (fan adds a new card) lives in
// src/lib/stripe/card-failure-recovery.ts.

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
  bindingCaptureIdempotencyKey,
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
//   'allocating' (a run's Phase 1 already committed — the RESUME path, not
//   a fresh run, owns that state), 'allocated' / 'complete' (done),
//   'draft' (no offers).
//
//   Step 2 (first statement of the Phase-1 transaction): markShowAllocating
//   CAS-es 'closed' → 'allocating'. Exactly one concurrent caller can win
//   that row; a loser throws BindingClaimLost so its transaction aborts
//   with zero writes and the run reports show_not_eligible.
//
// Crash recovery falls out of the same shape: dying between step 1 and the
// Phase-1 commit leaves the show 'closed', which is still due for the
// scheduled sweep — the next tick simply retries. Dying after Phase 1
// leaves 'allocating', which the sweep's stuck-show recovery (and the admin
// Run-binding button) routes into resumeBindingAllocation below.
class BindingClaimLost extends Error {
  constructor() {
    super("binding claim lost: show was not 'closed' at Phase-1 CAS");
    this.name = "BindingClaimLost";
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — decide & persist (no Stripe)
// ---------------------------------------------------------------------------

// JSON-serializable on purpose: the scheduled sweep runs this inside an
// Inngest step.run, whose return value is memoized as JSON across retries.
// No Dates, no class instances, plain numbers/strings only.
export type BindingPhase1Outcome =
  | {
      ok: true;
      value: {
        showId: string;
        stats: AllocationPlan["result"]["stats"];
        assignmentsWritten: number;
        logsWritten: number;
        autoRaised: number;
        displacementEventsWritten: number;
      };
    }
  | { ok: false; error: RunBindingError };

export async function runBindingPhase1(
  db: Db,
  showId: string,
): Promise<BindingPhase1Outcome> {
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

  // The auto-bid-settled pool the plan was built from. The raise
  // persistence below reads the RESOLVED price off these (≤ the offer's
  // cap, which is what we authorized at submission). Persisting the
  // resolved price onto the offer-of-record is what lets Phase 2 derive
  // the capture amount from the DB alone — the run never has to carry the
  // raised amount in memory across phases.
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

  // ---- The Phase-1 transaction: decide & persist atomically ----
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

  return {
    ok: true,
    value: {
      showId,
      stats: plan.result.stats,
      assignmentsWritten: plan.assignmentRows.length,
      logsWritten: plan.logRows.length,
      autoRaised: placedRaises.length,
      displacementEventsWritten: displacementEventRows.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 2/3 — settlement, derived entirely from DB state (re-entrant)
// ---------------------------------------------------------------------------

// The capture work list: offers still awaiting their terminal Phase-2 write.
// 'placed' is set only by Phase 1 and resolved only by captureBindingOffers
// (→ 'charged' / 'card_failure'), so "status = 'placed'" IS the resume set:
// already-settled offers ('charged', 'card_failure', and anything the
// card-failure recovery flow moved them to) drop out by construction.
// Ordered by id so retries and batch chunking are deterministic.
export async function listBindingSettlementWorklist(
  db: Db,
  showId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.showId, showId), eq(offers.status, "placed")))
    .orderBy(offers.id);
  return rows.map((r) => r.id);
}

export type CaptureBatchResult = {
  // Offers charged by (or discovered already-charged during) this call.
  captured: number;
  // Offers whose capture failed → flagged card_failure.
  cardFailures: number;
  // Offers left 'placed' because another worker holds the capture in
  // flight right now (Stripe idempotency_key_in_use). A later resume pass
  // settles them; the caller must NOT finalize the show while skipped > 0.
  skipped: number;
};

// Capture the given placed offers' auths and write each terminal state in
// its own small transaction. Idempotent by construction:
//   - Offers no longer 'placed' (a concurrent/previous worker settled them)
//     are skipped without touching Stripe.
//   - The capture carries a deterministic idempotency key, and an already-
//     'succeeded' PI counts as captured — so the crash window between a
//     successful capture and its terminal write converges on retry instead
//     of double-charging or flagging a paid fan as card_failure.
//   - The terminal write itself is a CAS ('placed' → terminal), so two
//     racing workers can't both count the same offer.
export async function captureBindingOffers(
  db: Db,
  stripe: Stripe,
  showId: string,
  offerIds: readonly string[],
): Promise<CaptureBatchResult> {
  const result: CaptureBatchResult = { captured: 0, cardFailures: 0, skipped: 0 };
  if (offerIds.length === 0) return result;

  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.showId, showId), inArray(offers.id, [...offerIds])))
    .orderBy(offers.id);

  for (const offer of rows) {
    // Re-check under current state: a previous attempt (or a concurrent
    // resume) may have already settled this offer. Settled = skip silently.
    if (offer.status !== "placed") continue;

    // Phase 1 persisted any auto-bid raise onto the offer-of-record, so
    // price × group_size here IS the resolved amount — always ≤ the cap we
    // authorized at submission.
    const amountCents = offer.pricePerTicketCents * offer.groupSize;

    let charged = false;
    let chargedAmountCents = amountCents;
    if (offer.stripePaymentIntentId) {
      const res = await captureOfferPaymentIntent(
        stripe,
        offer.stripePaymentIntentId,
        amountCents,
        {
          idempotencyKey: bindingCaptureIdempotencyKey(
            offer.id,
            offer.stripePaymentIntentId,
          ),
        },
      );
      if (res.ok) {
        charged = true;
        if (res.alreadyCaptured && res.amountReceivedCents !== undefined) {
          // A previous attempt captured this PI; record what Stripe says
          // actually moved (ground truth) rather than our recomputation.
          chargedAmountCents = res.amountReceivedCents;
        }
      } else if (res.code === "idempotency_key_in_use") {
        // Another worker's capture for this exact (offer, PI) is in flight
        // right now (e.g. an admin resume racing the sweep). Don't guess an
        // outcome — leave the offer 'placed'; whichever pass runs next will
        // see the settled state or retry cleanly.
        logger.warn(
          { offerId: offer.id, showId },
          "Binding capture in flight elsewhere — leaving offer placed",
        );
        result.skipped++;
        continue;
      } else {
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
      // CAS 'placed' → terminal so a racing worker can't double-write (and
      // so we never stomp a state the card-failure recovery flow owns).
      const won = await tx
        .update(offers)
        .set({ status: charged ? "charged" : "card_failure" })
        .where(and(eq(offers.id, offer.id), eq(offers.status, "placed")))
        .returning({ id: offers.id });
      if (won.length === 0) return;

      if (charged) {
        await tx
          .update(seatAssignments)
          .set({ chargedAmountCents })
          .where(eq(seatAssignments.offerId, offer.id));
        result.captured++;
      } else {
        await tx
          .update(seatAssignments)
          .set({ cardFailureAt: new Date() })
          .where(eq(seatAssignments.offerId, offer.id));
        result.cardFailures++;
      }
    });
  }

  return result;
}

// Release the auths on unplaced offers — the fan pays nothing. Idempotent:
// cancelOfferPaymentIntent treats an already-canceled (or otherwise
// terminal) PI as success, so a resume re-walking the full unplaced set
// converges without tracking which cancels already happened.
export async function cancelUnplacedAuths(
  db: Db,
  stripe: Stripe,
  showId: string,
): Promise<{ cancelled: number }> {
  const rows = await db
    .select({
      id: offers.id,
      stripePaymentIntentId: offers.stripePaymentIntentId,
    })
    .from(offers)
    .where(and(eq(offers.showId, showId), eq(offers.status, "unplaced")))
    .orderBy(offers.id);

  let cancelled = 0;
  for (const offer of rows) {
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
  return { cancelled };
}

// Phase 3: CAS the show 'allocating' → 'allocated', then send the outcome
// emails. The CAS makes finalization exactly-once under concurrent
// settlement passes — only the winner notifies, so fans don't get duplicate
// "you're in" emails when a manual resume races the sweep. (No transition
// other than this one touches an 'allocating' show: pause needs 'open',
// close needs 'open'/'paused', a rival binding run needs 'closed'.)
export async function finalizeBinding(
  db: Db,
  showId: string,
): Promise<{ finalized: boolean }> {
  const won = await db
    .update(shows)
    .set({ status: "allocated" })
    .where(and(eq(shows.id, showId), eq(shows.status, "allocating")))
    .returning({ id: shows.id });
  if (won.length === 0) {
    return { finalized: false };
  }

  // ---- Post-run: fan emails (best-effort, never fails the run) ----
  // Placed-and-charged → "you're in"; placed-but-card-failed → "add a card";
  // unplaced → "not placed, nothing charged". All three lists are derived
  // from the DB so a resumed run emails the fans charged BEFORE the crash
  // too — the crashed attempt never reached this point, so nobody has been
  // emailed yet. sendEmail no-ops without RESEND_API_KEY, so this is safe in
  // dev/CI. Wrapped so an email/DB hiccup can't undo a completed allocation.
  try {
    const show = await getShowById(db, showId);
    if (!show) return { finalized: true }; // defensive; FK makes this near-impossible

    const chargedRows = await db
      .select({
        userId: offers.userId,
        tier: seatAssignments.tier,
        chargedAmountCents: seatAssignments.chargedAmountCents,
        pricePerTicketCents: offers.pricePerTicketCents,
        groupSize: offers.groupSize,
      })
      .from(offers)
      .innerJoin(seatAssignments, eq(seatAssignments.offerId, offers.id))
      .where(and(eq(offers.showId, showId), eq(offers.status, "charged")));
    const placedCharged: BindingOutcomeOffer[] = chargedRows.map((r) => ({
      userId: r.userId,
      tier: r.tier,
      chargedAmountCents:
        r.chargedAmountCents ?? r.pricePerTicketCents * r.groupSize,
    }));

    const cardFailedRows = await db
      .select({ userId: offers.userId })
      .from(offers)
      .where(and(eq(offers.showId, showId), eq(offers.status, "card_failure")));
    const unplacedRows = await db
      .select({ userId: offers.userId })
      .from(offers)
      .where(and(eq(offers.showId, showId), eq(offers.status, "unplaced")));

    await notifyBindingOutcomes(db, {
      ctx: {
        showId,
        artistName: show.artist.name,
        showName: show.venue.name,
        doorsAt: show.doorsAt,
      },
      placed: placedCharged,
      cardFailed: cardFailedRows,
      unplaced: unplacedRows,
    });
  } catch (err) {
    logger.error(
      { event: "binding.notify.failed", showId, err },
      "Binding fan-notification dispatch failed (run already complete)",
    );
  }

  return { finalized: true };
}

// Executes a unit of settlement work under a caller-supplied wrapper. The
// scheduled sweep passes Inngest's step.run so each unit becomes its own
// durable, retryable step (and a completed unit is memoized across function
// retries); everywhere else the default just invokes the function. Step ids
// must be deterministic for a given show so Inngest's replay matches them up.
//
// Every wrapped return value must be JSON-serializable (Inngest memoizes
// step results as JSON) — see the result types above: plain counts and ids.
export type BindingStepRunner = <T>(
  id: string,
  fn: () => Promise<T>,
) => Promise<T>;

const directRunner: BindingStepRunner = (_id, fn) => fn();

// How many captures share one settlement step. Small enough that a single
// step stays well inside a serverless invocation (~10 × a couple seconds of
// Stripe latency), large enough that a big show doesn't explode into
// hundreds of steps.
const CAPTURE_BATCH_SIZE = 10;

export type SettleBindingResult = {
  captured: number;
  cardFailures: number;
  cancelled: number;
  // See CaptureBatchResult.skipped — non-zero means another worker held a
  // capture in flight, so the show was deliberately left 'allocating' for
  // a later pass.
  skipped: number;
  // Whether THIS pass won the 'allocating' → 'allocated' CAS (and so sent
  // the emails). False when a concurrent pass finalized first, or when
  // skipped > 0 kept the show open for another pass.
  finalized: boolean;
};

// Phases 2+3 end-to-end, from DB state alone. Safe to call any number of
// times on a show whose Phase 1 committed; each call settles whatever work
// remains and finishes by finalizing the show iff everything settled.
export async function settleBinding(
  db: Db,
  stripe: Stripe,
  showId: string,
  run: BindingStepRunner = directRunner,
): Promise<SettleBindingResult> {
  const worklist = await run(`binding-worklist-${showId}`, () =>
    listBindingSettlementWorklist(db, showId),
  );

  let captured = 0;
  let cardFailures = 0;
  let skipped = 0;
  for (let i = 0; i < worklist.length; i += CAPTURE_BATCH_SIZE) {
    const batch = worklist.slice(i, i + CAPTURE_BATCH_SIZE);
    const batchResult = await run(`binding-capture-${showId}-${i}`, () =>
      captureBindingOffers(db, stripe, showId, batch),
    );
    captured += batchResult.captured;
    cardFailures += batchResult.cardFailures;
    skipped += batchResult.skipped;
  }

  const { cancelled } = await run(`binding-cancel-unplaced-${showId}`, () =>
    cancelUnplacedAuths(db, stripe, showId),
  );

  // Don't finalize past in-flight captures: an offer left 'placed' because
  // another worker holds its idempotency key must be settled before the
  // show flips 'allocated' (nothing sweeps an 'allocated' show's stragglers).
  let finalized = false;
  if (skipped === 0) {
    const fin = await run(`binding-finalize-${showId}`, () =>
      finalizeBinding(db, showId),
    );
    finalized = fin.finalized;
  } else {
    logger.warn(
      { showId, skipped },
      "Binding settlement left in-flight captures — show stays 'allocating' for the next pass",
    );
  }

  return { captured, cardFailures, cancelled, skipped, finalized };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// The fresh, end-to-end binding run: Phase 1 (claim + decide + persist) then
// settlement. The default path for the admin button and the scheduled sweep.
export async function runBindingAllocation(
  db: Db,
  stripe: Stripe,
  showId: string,
): Promise<RunBindingOutcome> {
  const phase1 = await runBindingPhase1(db, showId);
  if (!phase1.ok) {
    return phase1;
  }

  const settle = await settleBinding(db, stripe, showId);

  return {
    ok: true,
    value: {
      showId,
      mode: "binding",
      ranAt: new Date(),
      stats: phase1.value.stats,
      assignmentsWritten: phase1.value.assignmentsWritten,
      logsWritten: phase1.value.logsWritten,
      captured: settle.captured,
      cardFailures: settle.cardFailures,
      cancelled: settle.cancelled,
      autoRaised: phase1.value.autoRaised,
      displacementEventsWritten: phase1.value.displacementEventsWritten,
    },
  };
}

export type ResumeBindingResult = {
  showId: string;
  mode: "binding";
  resumed: true;
  ranAt: Date;
  captured: number;
  cardFailures: number;
  cancelled: number;
  finalized: boolean;
};

export type ResumeBindingOutcome =
  | { ok: true; value: ResumeBindingResult }
  | { ok: false; error: RunBindingError };

// Resume a binding run whose Phase 1 committed but whose settlement died
// mid-flight (the show is stuck in 'allocating'). Rebuilds the remaining
// work from offer statuses and settles it — see the module header for why
// every step is idempotent. Reached two ways:
//   - the scheduled sweep's stuck-show recovery (automatic, ~10 min after
//     the checkpoint), and
//   - the admin Run-binding button on an 'allocating' show (the allocate
//     route routes 'allocating' here instead of bouncing 409).
//
// The status check is read-then-act on purpose — settlement is safe to run
// concurrently (capture CAS + idempotency keys, cancel soft-idempotency,
// finalize CAS), so a racing fresh run or second resume can't double-move
// money; at worst a pass does redundant no-op work.
export async function resumeBindingAllocation(
  db: Db,
  stripe: Stripe,
  showId: string,
): Promise<ResumeBindingOutcome> {
  const rows = await db
    .select({ status: shows.status })
    .from(shows)
    .where(eq(shows.id, showId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    return { ok: false, error: { kind: "show_not_found", showId } };
  }
  if (current.status !== "allocating") {
    return {
      ok: false,
      error: { kind: "show_not_eligible", status: current.status },
    };
  }

  logger.info({ showId }, "Resuming binding settlement for 'allocating' show");
  const settle = await settleBinding(db, stripe, showId);

  return {
    ok: true,
    value: {
      showId,
      mode: "binding",
      resumed: true,
      ranAt: new Date(),
      captured: settle.captured,
      cardFailures: settle.cardFailures,
      cancelled: settle.cancelled,
      finalized: settle.finalized,
    },
  };
}
