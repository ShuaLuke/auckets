// Presenters for the shows aggregate. Pure functions: take a raw DB shape
// from the repository layer plus `now: Date`, return a view shape ready for
// JSON serialization to the API client.
//
// The view shapes are designed to match the prototype JSX in
// design/ui_kits/auckets/screens/{Show,Dashboard,ArtistDashboard}.jsx
// field-for-field (minus deferred-needs-join fields like yourOffer / stats).
// When the UI port lands, swapping the prototype mocks for fetch results
// should be mechanical — same field names, same value shapes.
//
// Rules locked in for this layer (see slice-3 prompt):
//   - Pure. No new Date() inside; callers pass `now`. No env, no DB, no I/O.
//   - Status field stays raw (the enum string from the DB). statusLabel is
//     the formatted human-readable derivative. Both go in the view.
//   - Timestamps are always formatted strings in the view — never Date or
//     ISO strings — so JSON serialization can't surprise us.
//   - Money helpers come from src/lib/money.ts; format helpers from
//     ./format.ts. Don't inline either.

import type {
  SeatAssignment,
  ShowSummary,
  ShowWithRelations,
  TicketSummary,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers } from "../../../drizzle/schema";

import {
  DEFAULT_TZ,
  formatBindingCountdown,
  formatClock,
  formatCountdown,
  formatDateLong,
  formatDateShort,
  formatWeekday,
  isToday,
} from "./format";
import { presentOffer, presentStanding, type OfferView } from "./offers";

type Offer = typeof offers.$inferSelect;

// Raw show status from the DB (drizzle column is `text`, not an enum). The
// canonical seven listed in drizzle/schema.ts line 158. Kept as a string
// union so unknown future values still surface a TS error at the presenter
// boundary rather than silently rendering "undefined".
export type ShowStatus =
  | "draft"
  | "open"
  | "paused"
  | "closed"
  | "allocating"
  | "allocated"
  | "complete";

export type ShowSummaryView = {
  id: string;
  artist: string;
  venue: string;
  city: string | null;
  dateLong: string;
  dateShort: string;
  status: ShowStatus;
  statusLabel: string;
  closes: string;
  // Optional per the prototype Dashboard.jsx contract: yourOffer is null
  // for shows the fan hasn't engaged with yet. With exactOptionalProperty-
  // Types on, the key is omitted entirely in that case (rather than
  // serialized as `yourOffer: undefined`).
  yourOffer?: OfferView;
};

export type ShowDetailView = {
  id: string;
  artist: string;
  venue: string;
  city: string | null;
  dateLong: string;
  status: ShowStatus;
  statusLabel: string;
  bindingCountdown: string;

  // Structural data the offer composer in Show.jsx needs. Carried through
  // raw because the composer reads them as data, not as display strings.
  tierFloorsCents: Record<string, number>;
  maxGroupSize: number;
  activeRowIds: string[];
  bleacherEnabled: boolean;
  bleacherCapacity: number;
  bleacherPriceCents: number | null;
  venueArchitecture: {
    id: string;
    version: number;
    rows: VenueRow[];
  };
  // Show.jsx renders the offer composer pre-populated when the fan
  // already has an offer on this show; same exactOptionalPropertyTypes
  // convention as ShowSummaryView.
  yourOffer?: OfferView;
};

// Map raw enum → human label. Time-aware refinement (e.g. "Offers open Jun 18"
// when window hasn't opened yet) lives in the caller because it needs the
// dateShort of the offer window, not just the raw status.
function baseStatusLabel(status: ShowStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "open":
      return "Offers open";
    case "paused":
      return "Paused";
    case "closed":
      return "Closed";
    case "allocating":
      return "Allocating";
    case "allocated":
      return "Allocated";
    case "complete":
      return "Complete";
  }
}

function statusLabelFor(
  status: ShowStatus,
  offerWindowOpensAt: Date,
  now: Date,
  tz: string,
): string {
  // Matches the prototype's "Offers open Jun 18" pattern on the third
  // Dashboard row: status is open, but the window hasn't actually opened.
  if (status === "open" && offerWindowOpensAt.getTime() > now.getTime()) {
    return `Offers open ${formatDateShort(offerWindowOpensAt, tz)}`;
  }
  return baseStatusLabel(status);
}

// "closes" picks the most informative countdown for the current state:
//   - pre-window: bare countdown to window open ("23d")
//   - window open, pre-binding: countdown to binding ("12d until binding")
//   - otherwise: blank string. Post-binding states (closed/allocated/...)
//     show a ticket-or-doors countdown driven by per-user data in slice 4.
function closesFor(
  status: ShowStatus,
  offerWindowOpensAt: Date,
  bindingAllocationAt: Date,
  now: Date,
): string {
  const nowMs = now.getTime();
  if (status === "open" && offerWindowOpensAt.getTime() > nowMs) {
    return formatCountdown(offerWindowOpensAt, now);
  }
  if (status === "open" && bindingAllocationAt.getTime() > nowMs) {
    return formatBindingCountdown(bindingAllocationAt, now);
  }
  return "";
}

// userOffer is the *caller's* offer for this show (or null). It's a
// presenter parameter — not a repo lookup — because presenters stay pure:
// the route handler does the DB read and passes the result in. When
// null/undefined, the yourOffer key is omitted from the view entirely
// (exactOptionalPropertyTypes is on).
//
// userAssignment + userAssignmentRow thread through to yourOffer.preview
// ("Orchestra · Row AA · seats 7–10"). The summary path doesn't carry
// the architecture (it's a flat list), so the route handler resolves
// the row externally via getVenueArchitecturesByIds and hands the row
// in. If either is missing, the preview key is omitted.
//
// userTicket threads to yourOffer.ticketReady. The ticket-summary type
// is server-only-safe by construction (no totp_secret); see tickets.ts.
export function presentShowSummary(
  summary: ShowSummary,
  now: Date,
  tz: string = DEFAULT_TZ,
  userOffer: Offer | null = null,
  userAssignment: SeatAssignment | null = null,
  userAssignmentRow: Pick<VenueRow, "area" | "rowName"> | null = null,
  userTicket: Pick<TicketSummary, "status"> | null = null,
): ShowSummaryView {
  const status = summary.status as ShowStatus;
  const view: ShowSummaryView = {
    id: summary.id,
    artist: summary.artistName,
    venue: summary.venueName,
    city: summary.venueCity,
    dateLong: formatDateLong(summary.doorsAt, tz),
    dateShort: formatDateShort(summary.doorsAt, tz),
    status,
    statusLabel: statusLabelFor(status, summary.offerWindowOpensAt, now, tz),
    closes: closesFor(
      status,
      summary.offerWindowOpensAt,
      summary.bindingAllocationAt,
      now,
    ),
  };
  if (userOffer) {
    const offerView = presentOffer(
      userOffer,
      userAssignment,
      userAssignmentRow,
      userTicket,
    );
    // StandingLadder telemetry — only on a pre-binding ('open') offer that
    // hasn't been placed yet. A placed/ticket-ready offer leads in the
    // NowHero instead; an allocated show carries the result, not a preview.
    if (status === "open" && !offerView.placed) {
      const standing = presentStanding(
        userOffer,
        userAssignment,
        userAssignmentRow,
        summary.tierFloorsCents,
      );
      if (standing) offerView.standing = standing;
    }
    view.yourOffer = offerView;
  }
  return view;
}

// The NowHero lead band — the fan's single most important state, given the
// full stage (Change 02). Two shapes; the page picks one across all the
// fan's offer-shows by priority (ticket-ready > locking-in) then soonest.
const BINDING_IMMINENT_MS = 24 * 60 * 60 * 1000;

export type NowHeroView =
  | {
      kind: "ticket-ready";
      showId: string;
      eyebrow: string; // "You're in the room · tonight" | "· Sat"
      title: string; // "Citizen Cope at Lincoln Theatre"
      sub: string;
      seats: string; // "Orchestra · Row AA · seats 7–10"
      paid: string; // "$42.00 ×4"
      doors: string; // "4h 12m" — NOT animated
    }
  | {
      kind: "locking-in";
      showId: string;
      eyebrow: string; // "Seats lock in · 4h 12m"
      title: string;
      sub: string;
      offerLine: string; // "up to $55.00"
      projectedTier: string; // "Mid"
      locks: string; // "4h 12m"
    };

// Build the hero state for ONE offer-show, or null if it doesn't qualify as
// a lead. Pure: raw summary (for the dates) + the already-built OfferView
// (for ticket/standing/paid) + now. The page calls this per offer-show and
// selects the winner. Never promises a pay amount it doesn't have pre-
// binding (README §6.2); the locking-in state speaks only of the cap +
// where they'd land.
export function presentNowHero(
  summary: ShowSummary,
  offer: OfferView,
  now: Date,
  tz: string = DEFAULT_TZ,
): NowHeroView | null {
  const title = `${summary.artistName} at ${summary.venueName}`;

  // Priority 1 — a ready ticket. Needs the resolved seat preview string.
  if (offer.ticketReady && offer.preview) {
    const eyebrow = isToday(summary.doorsAt, now, tz)
      ? "You're in the room · tonight"
      : `You're in the room · ${formatWeekday(summary.doorsAt, tz)}`;
    return {
      kind: "ticket-ready",
      showId: summary.id,
      eyebrow,
      title,
      sub: `Doors ${formatClock(summary.doorsAt, tz)}. Your ticket unlocks when you arrive — geo-verified at the venue so it can't be screenshotted away.`,
      seats: offer.preview,
      paid: `${offer.paidPerTicket ?? offer.price} ×${offer.size}`,
      doors: formatCountdown(summary.doorsAt, now),
    };
  }

  // Priority 2 — binding within 24h on an open show, with a projection to
  // stand on.
  const msToBinding = summary.bindingAllocationAt.getTime() - now.getTime();
  if (
    summary.status === "open" &&
    offer.standing &&
    msToBinding > 0 &&
    msToBinding < BINDING_IMMINENT_MS
  ) {
    const locks = formatCountdown(summary.bindingAllocationAt, now);
    return {
      kind: "locking-in",
      showId: summary.id,
      eyebrow: `Seats lock in · ${locks}`,
      title,
      sub: `You're in — you'd land in ${offer.standing.projectedTier} right now. Raise your offer any time before then; you can never be moved down.`,
      offerLine: `up to ${offer.price}`,
      projectedTier: offer.standing.projectedTier,
      locks,
    };
  }

  return null;
}

export function presentShowDetail(
  show: ShowWithRelations,
  now: Date,
  tz: string = DEFAULT_TZ,
  userOffer: Offer | null = null,
  userAssignment: SeatAssignment | null = null,
  userTicket: Pick<TicketSummary, "status"> | null = null,
): ShowDetailView {
  const status = show.status as ShowStatus;
  const view: ShowDetailView = {
    id: show.id,
    artist: show.artist.name,
    venue: show.venue.name,
    city: show.venue.city,
    dateLong: formatDateLong(show.doorsAt, tz),
    status,
    statusLabel: statusLabelFor(status, show.offerWindowOpensAt, now, tz),
    bindingCountdown: formatCountdown(show.bindingAllocationAt, now),
    // tier_floors_cents lives in JSONB; the schema comment promises a
    // Record<string, number>. The repository hands back unknown — cast at
    // the presenter boundary so view consumers get a typed shape.
    tierFloorsCents: show.tierFloorsCents as Record<string, number>,
    maxGroupSize: show.maxGroupSize,
    activeRowIds: show.activeRowIds as string[],
    bleacherEnabled: show.bleacherEnabled,
    bleacherCapacity: show.bleacherCapacity,
    bleacherPriceCents: show.bleacherPriceCents,
    venueArchitecture: {
      id: show.venueArchitecture.id,
      version: show.venueArchitecture.version,
      rows: show.venueArchitecture.rows,
    },
  };
  if (userOffer) {
    // Detail path already has the architecture loaded — look up the
    // assignment's row in-place rather than asking the caller to
    // resolve it externally.
    const row = userAssignment
      ? show.venueArchitecture.rows.find((r) => r.id === userAssignment.venueRowId) ??
        null
      : null;
    view.yourOffer = presentOffer(userOffer, userAssignment, row, userTicket);
  }
  return view;
}
