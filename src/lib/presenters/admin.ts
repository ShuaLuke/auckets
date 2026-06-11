// Presenters for the admin command center (Change 05.3). Pure functions over
// raw repo shapes → the three things an operator needs at a glance:
//
//   1. A live health strip — offers live, seats placed, capture health, and
//      the next binding run. Only metrics with a real data source appear;
//      email/SMS send rates and a generic app-error count have no backing
//      table yet, so they're deliberately omitted rather than faked (flagged
//      in the PR). Counts are plain text — nothing animates a countdown.
//
//   2. A per-show ops line — the state plus the operator's next move, so the
//      list reads as a control board, not a backlog.
//
//   3. A post-binding reconciliation read — the proof the money was correct:
//      seats placed ↔ charges captured, loud when a card failure leaves money
//      unsettled.
//
// Admin is internal, so mechanism words ("binding", "allocation") are fine.
// Money is integer cents through formatCents; never an individual fan's offer.

import { formatCents } from "@/lib/money";

import type {
  ChargedTotals,
  OfferStatusCounts,
  ShowSummary,
} from "@/lib/db/repositories";

import { formatCountdown } from "./format";

// Shows still pre-result: offers are live and provisional fill is meaningful.
const PRE_RESULT_STATUSES = new Set([
  "open",
  "paused",
  "closed",
  "allocating",
]);
// Shows past the binding gate: charges have moved, reconciliation applies.
const RESULTED_STATUSES = new Set(["allocated", "complete"]);
// Shows with a binding run still ahead of them on the clock.
const SCHEDULED_BINDING_STATUSES = new Set(["open", "closed"]);

// Countdowns reuse the shared formatCountdown(target, now) — plain text,
// never animated (README §4); the page re-renders on navigation, not on a
// ticking timer.

function statusCount(counts: OfferStatusCounts | undefined, status: string): number {
  return counts?.[status] ?? 0;
}

export type AdminHealthView = {
  // Live demand across pre-result shows.
  offersLive: number;
  ticketsLive: number;
  // Provisional fill across pre-result shows.
  seatsPlaced: number;
  seatsCapacity: number;
  seatsPct: number;
  // Capture health across resulted shows.
  charged: number;
  cardFailures: number;
  captureOk: boolean;
  captureLabel: string;
  // Next scheduled binding run, or null when none is on the clock.
  nextBinding: { venue: string; countdown: string } | null;
};

export type AdminHealthInput = {
  shows: readonly ShowSummary[];
  offerStatsByShow: ReadonlyMap<string, { count: number; ticketsCount: number }>;
  statusCountsByShow: ReadonlyMap<string, OfferStatusCounts>;
  filledByShow: ReadonlyMap<string, number>;
  capacityByShowId: ReadonlyMap<string, number>;
  now: Date;
};

export function presentAdminHealth(input: AdminHealthInput): AdminHealthView {
  let offersLive = 0;
  let ticketsLive = 0;
  let seatsPlaced = 0;
  let seatsCapacity = 0;
  let charged = 0;
  let cardFailures = 0;
  let nextBindingShow: ShowSummary | null = null;

  for (const show of input.shows) {
    if (PRE_RESULT_STATUSES.has(show.status)) {
      const stats = input.offerStatsByShow.get(show.id);
      offersLive += stats?.count ?? 0;
      ticketsLive += stats?.ticketsCount ?? 0;
      seatsPlaced += input.filledByShow.get(show.id) ?? 0;
      seatsCapacity += input.capacityByShowId.get(show.id) ?? 0;
    }
    if (RESULTED_STATUSES.has(show.status)) {
      const counts = input.statusCountsByShow.get(show.id);
      charged += statusCount(counts, "charged");
      // 'recovering' (a recovery charge mid-flight) is the same ops
      // situation as card_failure: money not yet settled.
      cardFailures +=
        statusCount(counts, "card_failure") + statusCount(counts, "recovering");
    }
    if (
      SCHEDULED_BINDING_STATUSES.has(show.status) &&
      show.bindingAllocationAt.getTime() >= input.now.getTime()
    ) {
      if (
        nextBindingShow === null ||
        show.bindingAllocationAt.getTime() <
          nextBindingShow.bindingAllocationAt.getTime()
      ) {
        nextBindingShow = show;
      }
    }
  }

  return {
    offersLive,
    ticketsLive,
    seatsPlaced,
    seatsCapacity,
    seatsPct:
      seatsCapacity > 0 ? Math.round((seatsPlaced / seatsCapacity) * 100) : 0,
    charged,
    cardFailures,
    captureOk: cardFailures === 0,
    captureLabel:
      cardFailures === 0
        ? "All clear"
        : `${cardFailures} ${cardFailures === 1 ? "card needs" : "cards need"} attention`,
    nextBinding: nextBindingShow
      ? {
          venue: nextBindingShow.venueName,
          countdown: formatCountdown(
            nextBindingShow.bindingAllocationAt,
            input.now,
          ),
        }
      : null,
  };
}

export type ReconciliationView = {
  reconciled: boolean;
  label: string;
  chargedDisplay: string;
  detail: string;
};

export type AdminShowOpsView = {
  // The state + next move, e.g. "Offers open · 412 in pool · binding in 3d 4h".
  opsLine: string;
  // Only set for resulted shows (allocated / complete).
  reconciliation: ReconciliationView | null;
};

export type AdminShowOpsInput = {
  summary: ShowSummary;
  poolCount: number;
  statusCounts: OfferStatusCounts | undefined;
  chargedTotals: ChargedTotals | undefined;
  now: Date;
};

export function presentAdminShowOps(input: AdminShowOpsInput): AdminShowOpsView {
  const { summary, poolCount, now } = input;
  const bindingIn = formatCountdown(summary.bindingAllocationAt, now);

  let opsLine: string;
  switch (summary.status) {
    case "draft":
      opsLine = "Draft · not open yet";
      break;
    case "open":
      opsLine = `Offers open · ${poolCount} in pool · binding in ${bindingIn}`;
      break;
    case "paused":
      opsLine = `Paused · ${poolCount} in pool · resume to reopen`;
      break;
    case "closed":
      opsLine = `Closed · binding in ${bindingIn}`;
      break;
    case "allocating":
      opsLine = "Allocating now…";
      break;
    case "allocated":
      opsLine = "Allocated · binding complete";
      break;
    case "complete":
      opsLine = "Complete";
      break;
    default:
      opsLine = summary.status;
  }

  let reconciliation: ReconciliationView | null = null;
  if (RESULTED_STATUSES.has(summary.status)) {
    const charged = statusCount(input.statusCounts, "charged");
    // Same treatment as presentAdminHealth: an in-flight recovery is still
    // unsettled money.
    const cardFailures =
      statusCount(input.statusCounts, "card_failure") +
      statusCount(input.statusCounts, "recovering");
    const unplaced = statusCount(input.statusCounts, "unplaced");
    const amountCents = input.chargedTotals?.amountCents ?? 0;
    const chargedSeats = input.chargedTotals?.chargedSeats ?? 0;
    const reconciled = cardFailures === 0;
    reconciliation = {
      reconciled,
      label: reconciled
        ? "Seats ↔ charges reconciled"
        : `${cardFailures} card ${cardFailures === 1 ? "failure" : "failures"} — money unsettled`,
      chargedDisplay: formatCents(amountCents),
      detail: `${charged} charged · ${chargedSeats} seats · ${cardFailures} need a card · ${unplaced} not placed`,
    };
  }

  return { opsLine, reconciliation };
}
