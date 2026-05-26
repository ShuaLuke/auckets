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
  ShowSummary,
  ShowWithRelations,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers } from "../../../drizzle/schema";

import {
  DEFAULT_TZ,
  formatBindingCountdown,
  formatCountdown,
  formatDateLong,
  formatDateShort,
} from "./format";
import { presentOffer, type OfferView } from "./offers";

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
export function presentShowSummary(
  summary: ShowSummary,
  now: Date,
  tz: string = DEFAULT_TZ,
  userOffer: Offer | null = null,
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
    view.yourOffer = presentOffer(userOffer);
  }
  return view;
}

export function presentShowDetail(
  show: ShowWithRelations,
  now: Date,
  tz: string = DEFAULT_TZ,
  userOffer: Offer | null = null,
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
    view.yourOffer = presentOffer(userOffer);
  }
  return view;
}
