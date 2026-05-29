// Drizzle schema — single source of truth for the database.
//
// Transcribed from docs/SCHEMA_PLAN.md. When the two disagree, this file is
// authoritative; SCHEMA_PLAN.md is historical context. Migrations are
// generated from this file via `npm run db:generate`; never hand-edit a
// migration.
//
// Conventions (per docs/CONVENTIONS.md + ADR-0007):
//   - snake_case for tables and columns.
//   - Money columns end in `_cents` and use `integer`.
//   - Timestamps are timestamptz.
//   - UUIDs use `defaultRandom()` (pg's gen_random_uuid()).
//   - users.id is TEXT — Clerk's user IDs are not UUIDs.
//
// onDelete defaults to RESTRICT everywhere except pure join tables
// (artist_members), where CASCADE is safe. Almost everything in this system
// is audit-relevant or append-only; we never hard-delete a parent if children
// exist. Soft-delete via status fields where needed.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// 1. users — local mirror of Clerk users + Stripe customer info + role.
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  // Clerk user ID like "user_2abc..." — NOT a UUID. Treated as opaque text.
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  stripeCustomerId: text("stripe_customer_id"),
  cardLast4: text("card_last4"),
  cardBrand: text("card_brand"),
  // FAN | ARTIST | AUCKETS_ADMIN | VENUE_STAFF (ADR-0012). VENUE_STAFF lands
  // by Week 7. Kept as TEXT not enum so adding roles doesn't need a migration.
  role: text("role").notNull().default("FAN"),
  // Cache only. Source of truth is SUM(bond_events.delta) per prime
  // directive #7. Recomputable; never expose as canonical in APIs.
  bondScore: integer("bond_score").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 2. artists — the performer entity. One row per artist.
// ---------------------------------------------------------------------------
export const artists = pgTable("artists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  stripeConnectId: text("stripe_connect_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 3. artist_members — many-to-many between users and artists.
//
// SCHEMA_PLAN open-question C: ship now empty so we don't retrofit later.
// Only Cope uses it day one. CASCADE is safe here because this is a pure
// membership lookup — losing rows when an artist or user is deleted is
// correct behavior for a join table.
// ---------------------------------------------------------------------------
export const artistMembers = pgTable(
  "artist_members",
  {
    artistId: uuid("artist_id")
      .notNull()
      // CASCADE: pure join table; orphan membership rows have no meaning.
      .references(() => artists.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      // CASCADE: same reasoning.
      .references(() => users.id, { onDelete: "cascade" }),
    canManage: boolean("can_manage").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("artist_members_artist_user_unique").on(table.artistId, table.userId),
  ],
);

// ---------------------------------------------------------------------------
// 4. venues — physical buildings.
// ---------------------------------------------------------------------------
export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city"),
  // Venue centroid for QR geo-gate (ADR-0015). NUMERIC(9,6) gives ~11cm
  // precision, more than enough for "within 500m of the door."
  geoLat: numeric("geo_lat", { precision: 9, scale: 6 }),
  geoLon: numeric("geo_lon", { precision: 9, scale: 6 }),
  geoRadiusM: integer("geo_radius_m").notNull().default(500),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 5. venue_architectures — versioned seat-map for a venue. Immutable once
// published. New layouts get a new row, not an update.
// ---------------------------------------------------------------------------
export const venueArchitectures = pgTable(
  "venue_architectures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      // RESTRICT: an architecture is a snapshot a show may reference; deleting
      // the venue while history still references it would corrupt audit.
      .references(() => venues.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    // Array of row objects per GAE_SPEC §Inputs + VenueBuilder.jsx. Includes
    // manifest holds (ADA, sound desk). Per-show comp holds live on `shows`.
    rows: jsonb("rows").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("venue_architectures_venue_version_unique").on(table.venueId, table.version),
  ],
);

// ---------------------------------------------------------------------------
// 6. shows — a specific performance. Carries pricing, window, status, and
// partial-venue selection.
// ---------------------------------------------------------------------------
export const shows = pgTable(
  "shows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artistId: uuid("artist_id")
      .notNull()
      // RESTRICT: shows are audit-relevant; never silently lose them.
      .references(() => artists.id, { onDelete: "restrict" }),
    venueId: uuid("venue_id")
      .notNull()
      // RESTRICT: same reasoning.
      .references(() => venues.id, { onDelete: "restrict" }),
    venueArchitectureId: uuid("venue_architecture_id")
      .notNull()
      // RESTRICT: the architecture row is the snapshot the GAE ran against;
      // losing it would mean we can't replay the allocation.
      .references(() => venueArchitectures.id, { onDelete: "restrict" }),
    doorsAt: timestamp("doors_at", { withTimezone: true }).notNull(),
    offerWindowOpensAt: timestamp("offer_window_opens_at", { withTimezone: true }).notNull(),
    bindingAllocationAt: timestamp("binding_allocation_at", { withTimezone: true }).notNull(),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    // draft | open | paused | closed | allocating | allocated | complete
    // State machine docs land in docs/runbooks/show-lifecycle.md (Week 6).
    status: text("status").notNull().default("draft"),
    // { "premium": 4000, "mid": 1800, "rear": 1000 } — keys match
    // venue_architectures.rows[].tier.
    tierFloorsCents: jsonb("tier_floors_cents").notNull(),
    // Per-show override of platform default (10, per ADR-0011).
    maxGroupSize: integer("max_group_size").notNull().default(10),
    // Array of venue_architectures.rows[].id enabled for this show
    // (NEW-4 partial-venue activation).
    activeRowIds: jsonb("active_row_ids").notNull(),
    // Bleacher is gated on NEW-8 (Cope hasn't confirmed). Shipped with
    // DEFAULT false; drop later if Cope says no. See SCHEMA_PLAN.md §5.
    bleacherEnabled: boolean("bleacher_enabled").notNull().default(false),
    bleacherCapacity: integer("bleacher_capacity").notNull().default(0),
    bleacherPriceCents: integer("bleacher_price_cents"),
    // Per-show artist comp holds. Distinct from manifest holds, which live in
    // venue_architectures.rows[].holds. Different lifecycles: manifest holds
    // are always-true (ADA), show holds are per-show comp lists.
    showHolds: jsonb("show_holds").notNull().default(sql`'[]'::jsonb`),
    emailCustomization: jsonb("email_customization"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shows_artist_doors_idx").on(table.artistId, table.doorsAt),
    index("shows_status_idx").on(table.status),
    index("shows_binding_at_idx").on(table.bindingAllocationAt),
  ],
);

// ---------------------------------------------------------------------------
// 7. offers — a fan's bid on a show. One per fan per show (Q16).
// ---------------------------------------------------------------------------
export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: offers are payment-relevant and audit-relevant.
      .references(() => shows.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      // RESTRICT: never lose offers when a user record is deleted.
      .references(() => users.id, { onDelete: "restrict" }),
    // 'market' default. Bleacher channel gated on NEW-8; column ships now so
    // we don't migrate later. Drop if Cope rejects Bleacher.
    channel: text("channel").notNull().default("market"),
    groupSize: integer("group_size").notNull(),
    pricePerTicketCents: integer("price_per_ticket_cents").notNull(),
    // specific | this_or_better | this_or_worse | any (per GAE types).
    // Show.jsx UI currently exposes 3 of 4; schema keeps all 4. See
    // SCHEMA_PLAN.md §6 Open.
    tierPreference: text("tier_preference").notNull(),
    preferredTier: text("preferred_tier"),
    // GENERATED ALWAYS AS (price_per_ticket_cents::bigint * 1000 + group_size)
    // STORED. The canonical RankKey from GAE_SPEC. Postgres only supports
    // STORED, so drizzle-kit emits the STORED keyword automatically.
    rankKey: bigint("rank_key", { mode: "bigint" })
      .generatedAlwaysAs(sql`(price_per_ticket_cents::bigint * 1000 + group_size)`)
      .notNull(),
    autoBidEnabled: boolean("auto_bid_enabled").notNull().default(false),
    autoBidCapCents: integer("auto_bid_cap_cents"),
    // $5 default per Show.jsx. Per-offer so Q44 customizable triggers have
    // room to land.
    autoBidIncrementCents: integer("auto_bid_increment_cents").notNull().default(500),
    // ADR-0017 private offer threshold. NULL = public. Server-only — never
    // returned in an API response for any other user.
    privateThresholdCents: integer("private_threshold_cents"),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
    // stripe_setup_intent_id became nullable 2026-05-28 (slice 18). The
    // SetupIntent flow stays as the ADR-0003 fallback for >6-day
    // windows; under the 2026-05-27 ADR-0003 working assumption
    // (≤6-day window + auth-based hold) we use stripe_payment_intent_id
    // instead. The CHECK below enforces "at least one of these is set"
    // so the column-nullability change can't accidentally land rows
    // with no Stripe reference at all.
    stripeSetupIntentId: text("stripe_setup_intent_id"),
    // stripe_payment_intent_id — the PaymentIntent with
    // capture_method='manual' that holds the fan's card auth for the
    // duration of the offer window. Null when the offer was submitted
    // via the SetupIntent fallback path (or the dev stub).
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    // pool | placed | unplaced | charged | card_failure | refunded | resold |
    // gifted.
    status: text("status").notNull().default("pool"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    revisedAt: timestamp("revised_at", { withTimezone: true }),
  },
  (table) => [
    // Q16: one offer per fan per show.
    unique("offers_show_user_unique").on(table.showId, table.userId),
    // Soft cap; shows.max_group_size is the real cap enforced in app code.
    check("offers_group_size_check", sql`${table.groupSize} BETWEEN 1 AND 10`),
    check("offers_price_positive_check", sql`${table.pricePerTicketCents} > 0`),
    check(
      "offers_auto_bid_cap_check",
      sql`${table.autoBidEnabled} = false OR (${table.autoBidCapCents} IS NOT NULL AND ${table.autoBidCapCents} >= ${table.pricePerTicketCents})`,
    ),
    // Defensive: under either Stripe flow (SetupIntent fallback or the
    // auth-based PaymentIntent path), exactly one of these columns holds
    // the Stripe reference. The dev stub fills stripe_setup_intent_id
    // with a placeholder. Either way, every row must have at least one
    // intent ID so we can chase the row back to Stripe.
    check(
      "offers_stripe_intent_check",
      sql`${table.stripeSetupIntentId} IS NOT NULL OR ${table.stripePaymentIntentId} IS NOT NULL`,
    ),
    // The canonical "offer pool for allocation" query.
    index("offers_pool_idx").on(table.showId, table.status, table.rankKey.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 8. seat_assignments — output of the allocation engine. One per placed offer.
// ---------------------------------------------------------------------------
export const seatAssignments = pgTable(
  "seat_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .unique()
      // RESTRICT: deleting an offer that has an assignment would lose payment
      // history.
      .references(() => offers.id, { onDelete: "restrict" }),
    // Denormalized for query speed (the dashboard "this show's seats" query).
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: same reasoning as offers.show_id.
      .references(() => shows.id, { onDelete: "restrict" }),
    // Matches venue_architectures.rows[].id (a string inside JSONB), so TEXT
    // not UUID FK.
    venueRowId: text("venue_row_id").notNull(),
    seatNumbers: text("seat_numbers").array().notNull(),
    // Captured at placement so future tier renames don't rewrite history.
    tier: text("tier").notNull(),
    // false = preview; true = binding allocation.
    isBinding: boolean("is_binding").notNull().default(false),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    chargedAmountCents: integer("charged_amount_cents"),
    // Set when PaymentIntent fails. Triggers the recovery hold (CardFailure
    // window length is runtime config — see SCHEMA_PLAN.md §7 Open).
    cardFailureAt: timestamp("card_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("seat_assignments_show_binding_idx").on(table.showId, table.isBinding),
  ],
);

// ---------------------------------------------------------------------------
// 9. allocation_logs — append-only audit log of every allocation decision
// (SECURITY.md #19, prime directive #8).
// ---------------------------------------------------------------------------
export const allocationLogs = pgTable(
  "allocation_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: append-only audit. Never lose log rows.
      .references(() => shows.id, { onDelete: "restrict" }),
    // PLACED | SKIPPED | FIT_RESOLVED | ORPHAN_DETECTED | WATERFALLED |
    // MANUAL_OVERRIDE | RUN_START | RUN_END.
    action: text("action").notNull(),
    offerId: uuid("offer_id")
      // RESTRICT: keep audit pointers stable. Nullable for RUN_START / RUN_END.
      .references(() => offers.id, { onDelete: "restrict" }),
    venueRowId: text("venue_row_id"),
    seatNumbers: text("seat_numbers").array(),
    reason: text("reason").notNull(),
    // State at decision time per prime directive #8 (full snapshot, not just
    // IDs).
    snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
    // preview | binding.
    mode: text("mode").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("allocation_logs_show_created_idx").on(table.showId, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 10. artist_requests — pause / end-early / comp / override requests filed by
// artists, executed by AUCKETS staff (ADR-0013).
// ---------------------------------------------------------------------------
export const artistRequests = pgTable(
  "artist_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: audit trail.
      .references(() => shows.id, { onDelete: "restrict" }),
    requestedBy: text("requested_by")
      .notNull()
      // RESTRICT: keep request authorship stable.
      .references(() => users.id, { onDelete: "restrict" }),
    // comp | override | pause | end_early
    kind: text("kind").notNull(),
    details: text("details").notNull(),
    // open | executed | denied
    status: text("status").notNull().default("open"),
    executedBy: text("executed_by")
      // RESTRICT: keep operator audit stable. Nullable until actioned.
      .references(() => users.id, { onDelete: "restrict" }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // AUCKETS admin inbox: open requests, oldest first.
    index("artist_requests_status_created_idx").on(table.status, table.createdAt),
    index("artist_requests_show_idx").on(table.showId),
  ],
);

// ---------------------------------------------------------------------------
// 11. tickets — issued ticket for a binding seat assignment. Carries the TOTP
// secret for the rotating QR (ADR-0015).
// ---------------------------------------------------------------------------
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seatAssignmentId: uuid("seat_assignment_id")
      .notNull()
      .unique()
      // RESTRICT: a ticket is the audit anchor for a paid seat.
      .references(() => seatAssignments.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      // RESTRICT: ticket ownership is audit-relevant.
      .references(() => users.id, { onDelete: "restrict" }),
    // Base32-encoded otplib secret. Never exposed to the client.
    totpSecret: text("totp_secret").notNull(),
    // issued | scanned | resold | gifted | expired
    status: text("status").notNull().default("issued"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    scannedByStaffId: text("scanned_by_staff_id")
      // RESTRICT: door-scan attribution is audit-relevant.
      .references(() => users.id, { onDelete: "restrict" }),
    // Per TECHNICAL_INTEGRATION.md, tickets issue T-48h before doors.
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tickets_user_status_idx").on(table.userId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// 12. ticket_scans — append-only audit log of every QR scan, including
// invalid/replay (Scanner.jsx, SECURITY.md #19).
// ---------------------------------------------------------------------------
export const ticketScans = pgTable(
  "ticket_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable: invalid scans don't match a ticket.
    ticketId: uuid("ticket_id")
      // RESTRICT: keep scan history stable. ticket_id is already nullable for
      // invalid scans; RESTRICT applies only when a row exists.
      .references(() => tickets.id, { onDelete: "restrict" }),
    scannedByStaffId: text("scanned_by_staff_id")
      .notNull()
      // RESTRICT: scan attribution is audit-relevant.
      .references(() => users.id, { onDelete: "restrict" }),
    // ok | invalid | replay | expired_token | geo_failed | staff_override
    result: text("result").notNull(),
    reason: text("reason"),
    // Distance from venue centroid. Coordinates intentionally not stored
    // (ADR-0015 privacy).
    distanceM: integer("distance_m"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ticket_scans_ticket_idx").on(table.ticketId),
    index("ticket_scans_staff_created_idx").on(table.scannedByStaffId, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 13. resales — ticket sold back to pool (resale) or gifted (Miracle).
// Refunds seller at original price; any uplift goes to artist (ADR-0014).
// ---------------------------------------------------------------------------
export const resales = pgTable("resales", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    // RESTRICT: resales are payment audit.
    .references(() => tickets.id, { onDelete: "restrict" }),
  originalOfferId: uuid("original_offer_id")
    .notNull()
    // RESTRICT: seller's original offer anchors the refund.
    .references(() => offers.id, { onDelete: "restrict" }),
  newOfferId: uuid("new_offer_id")
    // RESTRICT: buyer's offer once matched. NULL forever for Miracle gifts.
    .references(() => offers.id, { onDelete: "restrict" }),
  // Cached at resale time — offers can be revised, but the refund references
  // the price at sale-back time.
  originalPriceCents: integer("original_price_cents").notNull(),
  newPriceCents: integer("new_price_cents"),
  // max(0, new_price - original_price). Anti-scalping per ADR-0014.
  artistAppreciationCents: integer("artist_appreciation_cents").notNull().default(0),
  // resale | miracle
  kind: text("kind").notNull(),
  // For named Miracles. NULL when gifted to waitlist top.
  recipientEmail: text("recipient_email"),
  // listed | matched | completed | cancelled | expired
  status: text("status").notNull().default("listed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 14. bond_events — append-only ledger of fan loyalty events
// (prime directive #7). Score is SUM(delta); formula can change, history
// cannot.
// ---------------------------------------------------------------------------
export const bondEvents = pgTable(
  "bond_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      // RESTRICT: bond events are append-only ledger. Never lose history.
      .references(() => users.id, { onDelete: "restrict" }),
    artistId: uuid("artist_id")
      .notNull()
      // RESTRICT: bond is per-artist, not platform-wide.
      .references(() => artists.id, { onDelete: "restrict" }),
    // offer_submitted | offer_placed | show_attended | resale | miracle_given
    // | miracle_received | integrity_flag
    kind: text("kind").notNull(),
    showId: uuid("show_id")
      // RESTRICT: keep audit pointer stable. Nullable — some events aren't
      // show-specific.
      .references(() => shows.id, { onDelete: "restrict" }),
    // Score impact at event-emit time. Immutable; formula evolves, events
    // don't.
    delta: integer("delta").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bond_events_user_artist_idx").on(table.userId, table.artistId),
    index("bond_events_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// 15. offer_idempotency_keys — backs the idempotency-key header on
// POST /api/offers (ADR-0010).
//
// The PK is the client-generated UUID itself, so the global PRIMARY KEY
// already guarantees the uniqueness SCHEMA_PLAN.md describes. The plan also
// lists UNIQUE(user_id, show_id, id) — redundant once id is the PK, so it's
// not encoded here. Flagged in the PR description.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 16. offer_revisions — append-only history of every offer state.
//
// upsertOfferForUser writes one row inside the same transaction on EVERY
// upsert: the initial INSERT records the submission state, and each UPDATE
// records the new state. Walking the rows ORDER BY recorded_at ASC
// reconstructs the offer's full timeline from first submission to the
// current state (which is also mirrored in the live offers row).
//
// Drives the /my-bids history expander and enables the "$30 → $40" diff
// copy on the ShowAdmin activity feed.
//
// Snapshot is jsonb so the schema can evolve without a migration here —
// what we capture today is the editable subset of the offers row, plus
// status, at the moment of write.
// ---------------------------------------------------------------------------
export const offerRevisions = pgTable(
  "offer_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      // RESTRICT: revisions are audit data. Never lose them when an offer
      // is cleaned up (which shouldn't happen anyway — offers are kept
      // for payment/refund history).
      .references(() => offers.id, { onDelete: "restrict" }),
    // Editable fields after the update (what the user just chose). Kept
    // as jsonb so adding a new editable field doesn't require a
    // migration on this table.
    snapshot: jsonb("snapshot").notNull(),
    // Captured at the moment of the UPDATE, inside the same transaction.
    // Defaults to NOW so the write path doesn't have to think about it.
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Per-offer history lookup, ordered most-recent-first.
    index("offer_revisions_offer_recorded_idx").on(
      table.offerId,
      table.recordedAt.desc(),
    ),
  ],
);

// ---------------------------------------------------------------------------
// 17. holds — seats removed from the allocation pool. Three sources today:
//
//   - ADA: accessibility holds set by the venue / AUCKETS staff.
//   - Artist comp: comps the artist files via the Request action dialog
//     (or, eventually, an Add hold form on ShowAdmin).
//   - Venue / Production: tech-related holds (sound desk, camera platform,
//     etc.) set by venue staff.
//
// `kind` drives the artist-vs-venue mutability boundary: artist-kind holds
// can be edited/removed by the artist themselves; venue-kind holds are
// read-only to the artist (the prototype renders a trash icon vs.
// READ-ONLY chip accordingly).
//
// Seat references mirror seat_assignments — denormalized venue_row_id as
// TEXT (matches venue_architectures.rows[].id inside JSONB), seat numbers
// as a TEXT[]. The GAE skips any seats listed in any holds row at
// allocation time.
// ---------------------------------------------------------------------------
export const holds = pgTable(
  "holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: holds are part of the show's audit trail; never lose
      // them implicitly when a show row goes away.
      .references(() => shows.id, { onDelete: "restrict" }),
    // Free-form source label ("ADA", "Artist comp", "Production", "Venue").
    // Surfaced as the chip text on the Holds card.
    source: text("source").notNull(),
    // 'venue' | 'artist' — see file-level comment.
    kind: text("kind").notNull(),
    // Matches venue_architectures.rows[].id (a string inside JSONB), so
    // TEXT not UUID FK. Same posture as seat_assignments.
    venueRowId: text("venue_row_id").notNull(),
    seatNumbers: text("seat_numbers").array().notNull(),
    // Optional free-form note ("sound desk", "camera platform").
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Per-show holds lookup ("show me every hold for show X").
    index("holds_show_idx").on(table.showId),
  ],
);

export const offerIdempotencyKeys = pgTable(
  "offer_idempotency_keys",
  {
    // Client-generated idempotency UUID.
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      // RESTRICT: idempotency rows can outlive the in-flight request and need
      // a stable user pointer for replay.
      .references(() => users.id, { onDelete: "restrict" }),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: same reasoning.
      .references(() => shows.id, { onDelete: "restrict" }),
    // The offer the first request created. NULL while in-flight.
    offerId: uuid("offer_id")
      // RESTRICT: cleanup happens via expires_at, not via parent deletes.
      .references(() => offers.id, { onDelete: "restrict" }),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Typically created_at + 24h. Cleanup cron uses the index below.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("offer_idempotency_keys_expires_idx").on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// 19. displacement_events — append-only per-fan alerts emitted by the
// displacement engine (ADR-0018 §4). Each persisted allocation compute
// (run-preview / run-binding) diffs each offer's outcome against the prior
// projection and records the transitions worth telling a fan about:
//
//   - 'auto_bid_raise' — an auto-bidder's effective price was raised to hold
//     its preferred section. detail: { fromCents, toCents, steps, tier }.
//   - 'section_change' — a placed offer moved to a different tier.
//     detail: { fromTier, toTier, direction: 'better' | 'worse' }.
//   - 'outbid_out'    — a previously-placed offer fell out of the event
//     entirely. detail: { fromTier }.
//
// Drives the in-app DisplacementToast first (ADR-0018 §4 delivery order);
// email/SMS dispatch reads the same rows later. Append-only: a row is the
// historical fact that a transition happened, never mutated except to stamp
// acknowledged_at when the fan dismisses the in-app alert.
// ---------------------------------------------------------------------------
export const displacementEvents = pgTable(
  "displacement_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      // RESTRICT: alerts are part of the show's audit trail.
      .references(() => shows.id, { onDelete: "restrict" }),
    offerId: uuid("offer_id")
      .notNull()
      // RESTRICT: keep the pointer to the offer the alert is about stable.
      .references(() => offers.id, { onDelete: "restrict" }),
    // Denormalized so the fan's "my alerts" query never has to join offers.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // 'auto_bid_raise' | 'section_change' | 'outbid_out'.
    kind: text("kind").notNull(),
    // Event-specific payload (see file comment). jsonb so the shape can grow
    // without a migration.
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    // NULL until the fan dismisses the in-app alert. Drives the
    // "unacknowledged alerts" query that the toast renders from.
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The fan's inbox: their unacknowledged alerts, newest first.
    index("displacement_events_user_ack_idx").on(
      table.userId,
      table.acknowledgedAt,
      table.createdAt.desc(),
    ),
    // Per-offer history + the dedup lookup (latest auto_bid_raise for an
    // offer) the preview runner does before emitting a fresh raise.
    index("displacement_events_offer_created_idx").on(
      table.offerId,
      table.createdAt.desc(),
    ),
  ],
);
