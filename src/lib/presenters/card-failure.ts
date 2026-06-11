// Presenter for the fan-facing card-failure recovery banner/modal (ADR-0003
// §5). Given the fan's own offer + its binding seat assignment, decide whether
// to surface the recovery CTA and with what copy. Repositories hand back raw
// rows; the window math + formatting live here.

import { formatCents } from "@/lib/money";

import type { Offer, SeatAssignment } from "@/lib/db/repositories";

export type CardFailureRecoveryView = {
  offerId: string;
  // "$120.00" — the amount the recovery charge will collect (price × size).
  amountLabel: string;
  // ISO deadline (card_failure_at + window) for a client-side countdown.
  deadlineIso: string;
  // Whole minutes remaining, floored at 0. For the "held for N more min" copy.
  minutesLeft: number;
};

// Returns the recovery view, or null when there's nothing to recover:
//   - the offer isn't in 'card_failure' / 'recovering' (never failed, already
//     recovered, or released to 'unplaced' once the window lapsed),
//   - there's no binding seat assignment / no card_failure_at stamp, or
//   - the window has already elapsed (the expiry cron will release it; we
//     don't offer a charge for a seat about to be freed).
//
// 'recovering' (a concurrent recovery is mid-charge — a seconds-long state)
// renders the same banner rather than flashing the page to "no result": if
// the fan resubmits, the recovery claim rejects the duplicate atomically.
export function presentCardFailureRecovery(
  offer: Offer | null,
  assignment: Pick<SeatAssignment, "cardFailureAt"> | null,
  now: Date,
  windowMinutes: number,
): CardFailureRecoveryView | null {
  if (!offer) return null;
  if (offer.status !== "card_failure" && offer.status !== "recovering") {
    return null;
  }
  if (!assignment?.cardFailureAt) return null;

  const deadline = new Date(
    assignment.cardFailureAt.getTime() + windowMinutes * 60_000,
  );
  if (now >= deadline) return null;

  const minutesLeft = Math.max(
    0,
    Math.floor((deadline.getTime() - now.getTime()) / 60_000),
  );

  return {
    offerId: offer.id,
    amountLabel: formatCents(offer.pricePerTicketCents * offer.groupSize),
    deadlineIso: deadline.toISOString(),
    minutesLeft,
  };
}
