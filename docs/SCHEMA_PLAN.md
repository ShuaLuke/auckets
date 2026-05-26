# Schema Plan

The authoritative shape of the AUCKETS database, reconciled against:

1. The design system's `design/handoff/TECHNICAL_INTEGRATION.md` § 2 (a schema proposal written before all the v2 product decisions landed)
2. Every screen in `design/ui_kits/auckets/screens/` (the actual data the UI reads + writes)
3. [`docs/GAE_SPEC.md`](GAE_SPEC.md) (the engine's input types)
4. The v2 ADRs ([0011](DECISIONS.md#adr-0011--group-size-cap--10)–[0017](DECISIONS.md#adr-0017--auto-bid--private-offers))
5. [`docs/OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) (what's still genuinely undecided)

**Status:** spec, not code. This document drives the Week 3 schema slice (`drizzle/schema.ts`). When the schema lands, the schema file becomes source of truth and this document moves to "historical reference" status.

---

## Reading guide

Each table section has:
- **Purpose** — what the table is for
- **Columns** — every column with its type and a one-line note
- **Constraints / indexes** — uniqueness, foreign keys, indexes
- **Provenance** — which doc/ADR/screen each column came from
- **Open** — questions or gaps that need a decision before Week 3 schema ships

Money is always `INTEGER` cents (column name ends `_cents`) per [ADR-0007](DECISIONS.md). Timestamps are `TIMESTAMPTZ` everywhere. Primary keys are `UUID DEFAULT gen_random_uuid()` unless noted.

---

## Tables — overview

| Table | Status vs. TECHNICAL_INTEGRATION.md § 2 |
|---|---|
| `users` | Adds `role`, `card_last4`, `card_brand` |
| `artists` | Unchanged |
| `venues` | Unchanged |
| `venue_architectures` | Unchanged |
| `shows` | Adds `max_group_size`, `active_row_ids`, `paused_at`, `email_customization`. `bleacher_*` columns gated on Cope's NEW-8 answer |
| `offers` | Adds `private_threshold_cents` (ADR-0017). `channel` column gated on NEW-8 |
| `seat_assignments` | Unchanged |
| `allocation_logs` | Unchanged |
| `artist_requests` | Unchanged |
| `tickets` | Unchanged |
| `ticket_scans` | **NEW** — door-scanner audit log |
| `resales` | Unchanged |
| `bond_events` | Unchanged |
| `offer_idempotency_keys` | **NEW** — per ADR-0010, not in the design doc's schema |

---

## 1. `users`

**Purpose:** Local mirror of Clerk users, plus the role and Stripe customer info we add on top.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Clerk user ID (e.g. `user_2abc...`). NOT a UUID. |
| `email` | `TEXT NOT NULL UNIQUE` | Mirrored from Clerk |
| `phone` | `TEXT` | E.164. Captured at signup or after first offer (per [OPEN_QUESTIONS Q33](OPEN_QUESTIONS.md)) |
| `stripe_customer_id` | `TEXT` | Created on first offer when we tokenize the card |
| `card_last4` | `TEXT` | For "•••• 4242" display in UI (AllocationFinal.jsx, CardFailure.jsx). Stored only if user opts in to a default payment method. |
| `card_brand` | `TEXT` | "visa", "mastercard", etc. |
| `role` | `TEXT NOT NULL DEFAULT 'FAN'` | `FAN` \| `ARTIST` \| `AUCKETS_ADMIN` \| `VENUE_STAFF`. Per [ADR-0012](DECISIONS.md#adr-0012--rbac-roles-mvp). `VENUE_STAFF` added by Week 7. |
| `bond_score` | `INTEGER NOT NULL DEFAULT 0` | **Cache only.** Source of truth is `SUM(bond_events.delta)` per [CONTEXT.md prime directive #7](CONTEXT.md#prime-directives--never-violate-these). Recomputable. Never expose as the canonical score in APIs. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Provenance:**
- `id, email, phone, stripe_customer_id, bond_score` — TECHNICAL_INTEGRATION.md § 2.1
- `card_last4, card_brand` — implied by AllocationFinal.jsx + CardFailure.jsx
- `role` — ADR-0012

**Open:**
- Should `role` be on `users` or a `user_roles` join table? Join table allows future multi-role users (e.g. an admin who's also an artist). Recommend join table — costs us one extra table, gains flexibility.
- Phone collection UX: bake into Clerk signup metadata or capture in a post-signup form? Per Q33 working assumption, optional after first offer.

---

## 2. `artists`

**Purpose:** The performer entity. One row per artist; for MVP this is just Cope.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `name` | `TEXT NOT NULL` | Display name (e.g. "Citizen Cope") |
| `slug` | `TEXT NOT NULL UNIQUE` | URL-safe (e.g. "citizen-cope") |
| `stripe_connect_id` | `TEXT` | Express Connect account ID. Set during artist onboarding. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Provenance:** TECHNICAL_INTEGRATION.md § 2.2.

**Open:**
- How are users linked to artists? An artist isn't directly a user — Cope-the-person has a `users.id` AND there's an `artists.id`. A join table `artist_members(artist_id, user_id, can_manage)` lets Cope's team manage shows on his behalf without giving everyone the `ARTIST` role globally. **Recommend adding this for Week 3** even though we only need Cope at MVP — it's cheap now, expensive to retrofit.

---

## 3. `venues`

**Purpose:** Physical building. One row per venue; an architecture is versioned separately.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | "Lincoln Theatre" |
| `city` | `TEXT` | Display only |
| `geo_lat` | `NUMERIC(9,6)` | Venue centroid — used for QR geo-gate per [ADR-0015](DECISIONS.md#adr-0015--rotating-geo-gated-qr-ticket) |
| `geo_lon` | `NUMERIC(9,6)` | |
| `geo_radius_m` | `INTEGER NOT NULL DEFAULT 500` | Geo-gate radius. Per ADR-0015 + TicketViewer.jsx ("within ~500m"). Per-venue configurable. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Provenance:** TECHNICAL_INTEGRATION.md § 2.3 + ADR-0015 + TicketViewer.jsx.

**Open:**
- For Cope's place (~50 cap private venue), do we want geo-gate to be optional / configurable to "off"? Probably yes — `geo_radius_m: NULL` could mean "no geo check." Document this in the runbook when geo work lands.

---

## 4. `venue_architectures`

**Purpose:** Versioned seat-map for a venue. Immutable once published; new versions get a new row.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `venue_id` | `UUID NOT NULL REFERENCES venues(id)` | |
| `version` | `INTEGER NOT NULL` | Monotonically increasing per venue |
| `rows` | `JSONB NOT NULL` | Array of row objects — see shape below |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Constraints:** `UNIQUE (venue_id, version)`.

**JSONB `rows[]` shape** (per [GAE_SPEC.md §Inputs](GAE_SPEC.md) + VenueBuilder.jsx):

```json
[
  {
    "id":           "row_aa_orch",
    "name":         "AA",
    "area":         "orchestra",
    "tier":         "premium",
    "row_rank":     2,
    "capacity":     20,
    "parity":       "EVEN",
    "lean":         "CENTER",
    "seat_numbers": ["1","3","5","7","9","11","13","15","17","19"],
    "holds": [
      { "seat_numbers": ["1","2","19","20"], "source": "ADA",        "mutable": false },
      { "seat_numbers": ["7","8"],           "source": "artist_comp", "mutable": true  }
    ],
    "is_ga":        false
  }
]
```

**Provenance:** Combination of TECHNICAL_INTEGRATION.md § 2.4 + GAE types (`VenueRow`) + VenueBuilder.jsx + ShowAdmin.jsx Holds tab.

**Note:** `holds` here are *manifest-level* holds (always-true for this venue). Per-show holds (artist comp for a specific show) live separately — see Open below.

**Open:**
- **Per-show holds.** Manifest holds are immutable per venue; artist comps for a specific show are different. Options:
  - (a) Bake show-specific holds into the `shows` table via a JSONB column.
  - (b) Separate `show_holds` table.
  - (c) Hybrid: manifest holds in venue_architectures, show holds in shows.
  - Recommend (c). Manifest holds = "always unavailable (ADA, sound desk)." Show holds = "this show's comp list." Different lifecycle, deserve different storage.

---

## 5. `shows`

**Purpose:** A specific performance of an artist at a venue on a date. Carries pricing, window, status, partial-venue selection.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `artist_id` | `UUID NOT NULL REFERENCES artists(id)` | |
| `venue_id` | `UUID NOT NULL REFERENCES venues(id)` | |
| `venue_architecture_id` | `UUID NOT NULL REFERENCES venue_architectures(id)` | Snapshot of which version was used |
| `doors_at` | `TIMESTAMPTZ NOT NULL` | Showtime |
| `offer_window_opens_at` | `TIMESTAMPTZ NOT NULL` | When fans can start submitting |
| `binding_allocation_at` | `TIMESTAMPTZ NOT NULL` | Default `doors_at - 24h` |
| `paused_at` | `TIMESTAMPTZ` | Set when AUCKETS staff pause (per [ADR-0013](DECISIONS.md#adr-0013--aucketscontrolled-pause-and-endearly)). NULL when not paused. |
| `status` | `TEXT NOT NULL DEFAULT 'draft'` | `draft` \| `open` \| `paused` \| `closed` \| `allocating` \| `allocated` \| `complete` |
| `tier_floors_cents` | `JSONB NOT NULL` | `{ "premium": 4000, "mid": 1800, "rear": 1000 }` — keys match `venue_architectures.rows[].tier` |
| `max_group_size` | `INTEGER NOT NULL DEFAULT 10` | Per-show override of the platform default (10). Per [ADR-0011](DECISIONS.md#adr-0011--group-size-cap--10). |
| `active_row_ids` | `JSONB NOT NULL` | Array of `venue_architectures.rows[].id` enabled for this show. Per [NEW-4](OPEN_QUESTIONS.md) partial-venue activation. |
| `bleacher_enabled` | `BOOLEAN NOT NULL DEFAULT false` | **Gated on NEW-8 (Cope hasn't confirmed Bleacher)** |
| `bleacher_capacity` | `INTEGER NOT NULL DEFAULT 0` | Same gate |
| `bleacher_price_cents` | `INTEGER` | Same gate |
| `show_holds` | `JSONB NOT NULL DEFAULT '[]'` | Array of `{ row_id, seat_numbers[], source, reason }`. Artist comps for THIS show specifically. Distinct from manifest holds. |
| `email_customization` | `JSONB` | Per-show email overrides per Q37b ("Auckets works with artist before each show to customize"). NULL when no overrides. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(artist_id, doors_at)` — for artist dashboard sort
- `(status)` — for the Inngest scheduled binding job
- `(binding_allocation_at)` — for the cron trigger

**Provenance:**
- Core fields — TECHNICAL_INTEGRATION.md § 2.5
- `paused_at`, `email_customization` — ADR-0013 + Q37b
- `max_group_size` — ADR-0011
- `active_row_ids` — NEW-4 + ShowAdmin.jsx active section selector
- `show_holds` — ShowAdmin.jsx Holds tab + Q25 working assumption
- `bleacher_*` — design doc + ShowCreate.jsx (but gated on NEW-8)

**Open:**
- **`bleacher_*` columns** depend on Cope confirming Bleacher (NEW-8). Two paths:
  - (a) Add them now with `DEFAULT false / 0 / NULL`. If Cope says no, the columns sit unused until dropped. Cheap.
  - (b) Hold off; add via migration once Cope answers. Slightly cleaner schema; one extra migration.
  - Recommend (a). The columns are cheap and the design clearly intends Bleacher.
- **`status` transitions** — need a state machine doc somewhere. Probably belongs in `docs/runbooks/show-lifecycle.md` once we build the artist dashboard. Document allowed transitions: `draft → open → (paused ↔ open) → closed → allocating → allocated → complete`.

---

## 6. `offers`

**Purpose:** A fan's bid on a show. One per fan per show.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `show_id` | `UUID NOT NULL REFERENCES shows(id)` | |
| `user_id` | `TEXT NOT NULL REFERENCES users(id)` | Clerk user ID |
| `channel` | `TEXT NOT NULL DEFAULT 'market'` | `market` \| `bleacher` (Bleacher conditional on NEW-8) |
| `group_size` | `INTEGER NOT NULL` | 1 ≤ N ≤ `shows.max_group_size` (default 10). Bleacher: 1-2 per design. |
| `price_per_ticket_cents` | `INTEGER NOT NULL` | Market: fan's offer. Bleacher: copy of `shows.bleacher_price_cents`. |
| `tier_preference` | `TEXT NOT NULL` | `specific` \| `this_or_better` \| `this_or_worse` \| `any` (per [GAE types](GAE_SPEC.md). **UI currently only exposes 3 of these** — see Open) |
| `preferred_tier` | `TEXT` | Required when `tier_preference != 'any'`. NULL otherwise. |
| `rank_key` | `BIGINT GENERATED ALWAYS AS (price_per_ticket_cents::BIGINT * 1000 + group_size) STORED` | Per [GAE_SPEC §RankKey](GAE_SPEC.md). |
| `auto_bid_enabled` | `BOOLEAN NOT NULL DEFAULT false` | [ADR-0017](DECISIONS.md#adr-0017--auto-bid--private-offers) |
| `auto_bid_cap_cents` | `INTEGER` | Max price for auto-raises. NULL when auto-bid disabled. |
| `auto_bid_increment_cents` | `INTEGER NOT NULL DEFAULT 500` | $5 default per Show.jsx. Configurable per offer. |
| `private_threshold_cents` | `INTEGER` | ADR-0017 private offer. NULL for public offers. Server-only — never returned in any API for a different user. |
| `stripe_payment_method_id` | `TEXT NOT NULL` | Saved card token |
| `stripe_setup_intent_id` | `TEXT NOT NULL` | For audit |
| `status` | `TEXT NOT NULL DEFAULT 'pool'` | `pool` \| `placed` \| `unplaced` \| `charged` \| `card_failure` \| `refunded` \| `resold` \| `gifted` |
| `submitted_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `revised_at` | `TIMESTAMPTZ` | Set on each upward revision per Q12 |

**Constraints:**
- `UNIQUE (show_id, user_id)` — one offer per fan per show, per Q16
- `CHECK (group_size BETWEEN 1 AND 10)` — soft cap; `shows.max_group_size` is the real cap
- `CHECK (price_per_ticket_cents > 0)`
- `CHECK ((auto_bid_enabled = false) OR (auto_bid_cap_cents IS NOT NULL AND auto_bid_cap_cents >= price_per_ticket_cents))`

**Indexes:**
- `(show_id, status, rank_key DESC)` — the canonical "offer pool for allocation" query

**Provenance:**
- Core fields — TECHNICAL_INTEGRATION.md § 2.7
- `auto_bid_*` + `private_threshold_cents` — ADR-0017
- `auto_bid_increment_cents` — Show.jsx default $5; making it per-offer leaves room for the Q44 "customizable triggers" Phase 2 work
- `channel` — design doc (gated on NEW-8)

**Open:**
- **`channel: 'bleacher'`** — same NEW-8 gate as `shows.bleacher_*`.
- **UI mismatch on `tier_preference`.** GAE types and TECHNICAL_INTEGRATION list 4 options; Show.jsx UI exposes only 3 (drops `this_or_better`). Is `this_or_better` actually a real fan need, or is it spec-only? **Recommend: keep all 4 in the schema; Show.jsx adds `this_or_better` when we port the UI** — it's a real case (someone bidding mid hoping to be bumped UP to premium isn't crazy but is rare).
- **`private_threshold_cents` UI is missing entirely** from the prototypes. Show.jsx doesn't expose the field. **Recommend: schema has the column from day one** (ADR-0017 confirms it), UI adds it in Week 4 as an "advanced" toggle.
- **`status` reconciliation** with `seat_assignments.is_binding` — `charged` implies a placed binding seat with a successful payment. Avoid two-sources-of-truth bugs by deriving where possible.

---

## 7. `seat_assignments`

**Purpose:** Output of the allocation engine. One row per offer that got placed.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `offer_id` | `UUID NOT NULL UNIQUE REFERENCES offers(id)` | One assignment per offer |
| `show_id` | `UUID NOT NULL REFERENCES shows(id)` | Denormalized for query speed |
| `venue_row_id` | `TEXT NOT NULL` | Matches `venue_architectures.rows[].id` |
| `seat_numbers` | `TEXT[] NOT NULL` | E.g. `{'7','9','11','13'}` |
| `tier` | `TEXT NOT NULL` | Captured at placement time so future tier renames don't change history |
| `is_binding` | `BOOLEAN NOT NULL DEFAULT false` | False for preview placements, true after binding allocation |
| `stripe_payment_intent_id` | `TEXT` | NULL until charged |
| `charged_amount_cents` | `INTEGER` | NULL until charged |
| `card_failure_at` | `TIMESTAMPTZ` | Set when PaymentIntent fails. Triggers the recovery hold (see CardFailure.jsx). NULL when no failure. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(show_id, is_binding)` — for the "current binding placements" query

**Provenance:** TECHNICAL_INTEGRATION.md § 2.8 + CardFailure.jsx + AllocationFinal.jsx.

**Open:**
- **Card failure recovery window: 30 min vs 24h.** CardFailure.jsx shows 30 minutes; ADR-0003 says "grace window (proposed: 24 hours)." **This needs to be reconciled before Week 5.** The schema doesn't have to encode the window length (it's a config value), but the operational story has to be decided. 30 min is aggressive for "I'm at work and missed the email"; 24h is generous but holds seats out of the pool too long. Recommend a middle ground (e.g., 4 hours) — flag for Cope/Julia decision.

---

## 8. `allocation_logs`

**Purpose:** Append-only audit log of every allocation decision. Per [SECURITY.md #19](SECURITY.md).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `show_id` | `UUID NOT NULL REFERENCES shows(id)` | |
| `action` | `TEXT NOT NULL` | `PLACED` \| `SKIPPED` \| `FIT_RESOLVED` \| `ORPHAN_DETECTED` \| `WATERFALLED` \| `MANUAL_OVERRIDE` \| `RUN_START` \| `RUN_END` (per GAE types + design doc) |
| `offer_id` | `UUID REFERENCES offers(id)` | Nullable for `RUN_START` / `RUN_END` |
| `venue_row_id` | `TEXT` | Matches `venue_architectures.rows[].id`. Nullable. |
| `seat_numbers` | `TEXT[]` | Nullable |
| `reason` | `TEXT NOT NULL` | Human-readable explanation |
| `snapshot` | `JSONB NOT NULL DEFAULT '{}'` | State at decision time |
| `mode` | `TEXT NOT NULL` | `preview` \| `binding` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(show_id, created_at DESC)` — for the show admin recent-activity feed

**Provenance:** TECHNICAL_INTEGRATION.md § 2.9 + ShowAdmin.jsx Overview tab "Recent activity."

**Open:** None.

---

## 9. `artist_requests`

**Purpose:** Pause, end-early, comp, and override requests filed by artists, executed by AUCKETS staff. Per [ADR-0013](DECISIONS.md#adr-0013--aucketscontrolled-pause-and-endearly).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `show_id` | `UUID NOT NULL REFERENCES shows(id)` | |
| `requested_by` | `TEXT NOT NULL REFERENCES users(id)` | Clerk user ID of the requesting artist/manager |
| `kind` | `TEXT NOT NULL` | `comp` \| `override` \| `pause` \| `end_early` |
| `details` | `TEXT NOT NULL` | Free-form text from the artist (per ShowAdmin.jsx RequestActionDialog) |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | `open` \| `executed` \| `denied` |
| `executed_by` | `TEXT REFERENCES users(id)` | AUCKETS admin who actioned. NULL until executed. |
| `executed_at` | `TIMESTAMPTZ` | NULL until executed |
| `notes` | `TEXT` | AUCKETS admin's notes when executing/denying |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(status, created_at)` — for the AUCKETS admin inbox ("open requests, oldest first")
- `(show_id)` — for per-show audit

**Provenance:** TECHNICAL_INTEGRATION.md § 2.10 + ShowAdmin.jsx RequestActionDialog + ADR-0013.

**Open:**
- **Where do executed requests appear in `allocation_logs`?** When a `comp` request is executed, it produces a `MANUAL_OVERRIDE` row in `allocation_logs` that should reference back to the `artist_requests.id` (e.g. via `snapshot.artist_request_id`). Document this convention in the runbook when implementing.
- **Routing.** The ShowAdmin RequestActionDialog mockup says "routes_to=ops@auckets.com + #ops-{show_id}" — is the Slack channel real or flavor? **Recommend: email-only at MVP.** Slack integration is its own (small) project.

---

## 10. `tickets`

**Purpose:** Issued ticket for a binding seat assignment. Carries the TOTP secret for the rotating QR. Per [ADR-0015](DECISIONS.md#adr-0015--rotating-geo-gated-qr-ticket).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `seat_assignment_id` | `UUID NOT NULL UNIQUE REFERENCES seat_assignments(id)` | One ticket per assignment |
| `user_id` | `TEXT NOT NULL REFERENCES users(id)` | Who can display the ticket |
| `totp_secret` | `TEXT NOT NULL` | Base32-encoded, 32 chars. Used by `otplib` to generate the rotating code. **Never exposed to the client.** |
| `status` | `TEXT NOT NULL DEFAULT 'issued'` | `issued` \| `scanned` \| `resold` \| `gifted` \| `expired` |
| `scanned_at` | `TIMESTAMPTZ` | NULL until scanned |
| `scanned_by_staff_id` | `TEXT REFERENCES users(id)` | The `VENUE_STAFF` user who scanned. NULL until scanned. |
| `issued_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Per TECHNICAL_INTEGRATION.md, tickets are issued T-48h before doors |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(user_id, status)` — for fan dashboard "my tickets" query

**Provenance:** TECHNICAL_INTEGRATION.md § 2.11 + TicketViewer.jsx + ADR-0015.

**Open:**
- Should the rotation window (60s) be a per-ticket field or a global constant? Per ADR-0015 it's a constant (60s for production); making it per-ticket adds complexity for no benefit. **Recommend: constant in code, not in schema.**

---

## 11. `ticket_scans` — NEW (not in TECHNICAL_INTEGRATION.md)

**Purpose:** Append-only audit log of every QR scan attempt, including invalid/replay. Per Scanner.jsx + [SECURITY.md #19](SECURITY.md) ("every meaningful event gets a structured log line").

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `ticket_id` | `UUID REFERENCES tickets(id)` | Nullable — invalid scans don't match a ticket |
| `scanned_by_staff_id` | `TEXT NOT NULL REFERENCES users(id)` | The `VENUE_STAFF` user |
| `result` | `TEXT NOT NULL` | `ok` \| `invalid` \| `replay` \| `expired_token` \| `geo_failed` \| `staff_override` |
| `reason` | `TEXT` | Free-form when `result != 'ok'` |
| `distance_m` | `INTEGER` | Distance from venue centroid. **Coordinates not stored** (privacy per ADR-0015). |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(ticket_id)` — for fan-facing "show me my scan history" if we ever build it
- `(scanned_by_staff_id, created_at DESC)` — for the door-staff "my recent scans" view (Scanner.jsx right column)

**Provenance:** Scanner.jsx (recent scans list, ok/invalid/replay statuses).

**Open:**
- **Staff-override flow:** Scanner.jsx has a "Look up by name + ID" button. When staff manually admits someone whose phone is dead, write a `ticket_scans` row with `result = 'staff_override'`. Schema supports it; no extra columns needed.

---

## 12. `resales`

**Purpose:** Tracks a ticket being sold back to the pool (resale) or gifted (Miracle). Per [ADR-0014](DECISIONS.md#adr-0014--resale-capped-at-original-price).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `ticket_id` | `UUID NOT NULL REFERENCES tickets(id)` | The ticket being sold/gifted |
| `original_offer_id` | `UUID NOT NULL REFERENCES offers(id)` | The seller's original offer |
| `new_offer_id` | `UUID REFERENCES offers(id)` | The buyer's offer. NULL until matched; NULL forever for Miracle gifts. |
| `original_price_cents` | `INTEGER NOT NULL` | Cached at resale time (offers may revise) |
| `new_price_cents` | `INTEGER` | Cached at match time. NULL until matched. |
| `artist_appreciation_cents` | `INTEGER NOT NULL DEFAULT 0` | `max(0, new_price - original_price)` |
| `kind` | `TEXT NOT NULL` | `resale` \| `miracle` |
| `recipient_email` | `TEXT` | For named Miracles. NULL when gifted to waitlist top. |
| `status` | `TEXT NOT NULL DEFAULT 'listed'` | `listed` \| `matched` \| `completed` \| `cancelled` \| `expired` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `completed_at` | `TIMESTAMPTZ` | |

**Provenance:** TECHNICAL_INTEGRATION.md § 2.12 + ResaleFlow.jsx + ADR-0014.

**Open:**
- **Miracle gifting to a non-existent user.** If `recipient_email` doesn't match an existing user, do we (a) email them an invite link, (b) reject the gift, or (c) hold the gift pending signup? Design says "they have 24 hours to claim" — implies (a) or (c). Recommend (a) — email a magic link that signs them up + accepts in one flow.
- **Refund timing.** ResaleFlow.jsx says "refund within 48 hours" — that's Stripe's standard refund timing, not something we control. Document in the runbook.

---

## 13. `bond_events`

**Purpose:** Append-only ledger of fan loyalty events. Per [CONTEXT.md prime directive #7](CONTEXT.md#prime-directives--never-violate-these).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | |
| `user_id` | `TEXT NOT NULL REFERENCES users(id)` | |
| `artist_id` | `UUID NOT NULL REFERENCES artists(id)` | Bond is per-artist, not platform-wide |
| `kind` | `TEXT NOT NULL` | `offer_submitted` \| `offer_placed` \| `show_attended` \| `resale` \| `miracle_given` \| `miracle_received` \| `integrity_flag` |
| `show_id` | `UUID REFERENCES shows(id)` | Nullable — some events aren't show-specific |
| `delta` | `INTEGER NOT NULL DEFAULT 0` | The score impact. Formula evolves over time; events are immutable. |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` | Per-kind specifics |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

**Indexes:**
- `(user_id, artist_id)` — the canonical "what's my Bond with this artist" query
- `(user_id, created_at DESC)` — for fan history view

**Provenance:** TECHNICAL_INTEGRATION.md § 2.13 + CONTEXT.md prime directive #7.

**Open:**
- **`delta` vs storing the formula separately.** Pre-computing `delta` at event-emit time means the formula at the time of the event is what counts. If we change the formula later, old events keep their `delta` — that's *intentional* per "the score is a SUM, the formula can change; history cannot." When the formula changes, we run a one-time backfill that updates `delta` on historical events (if we want) or leaves them at their original delta (the safer default).

---

## 14. `offer_idempotency_keys` — NEW (per [ADR-0010](DECISIONS.md#adr-0010--idempotency-keys-on-offer-submission))

**Purpose:** Backs the idempotency-key header on `POST /api/offers` so network retries don't create duplicate offers / duplicate Stripe intents.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | The client-generated idempotency UUID |
| `user_id` | `TEXT NOT NULL REFERENCES users(id)` | |
| `show_id` | `UUID NOT NULL REFERENCES shows(id)` | |
| `offer_id` | `UUID REFERENCES offers(id)` | The offer the first request created. NULL while in-flight. |
| `response_status` | `INTEGER` | HTTP status of the original response |
| `response_body` | `JSONB` | The exact JSON we returned to the client |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ NOT NULL` | `created_at + 24h` typically |

**Constraints:** `UNIQUE (user_id, show_id, id)` — the same key can be reused across shows.

**Indexes:** `(expires_at)` — for the cleanup cron.

**Provenance:** ADR-0010.

**Open:**
- Could be implemented as a Redis cache instead of a Postgres table. Postgres is simpler given we already have it and the volume is low. **Recommend: Postgres for MVP**, revisit if it becomes hot.

---

## What's NOT a table

A few concepts that show up in the UI but are derived, not stored:

- **`shows.aggregates`** — totals/averages for the artist dashboard (medianPrice, topPrice, capacityFilled, payout). These are computed from `offers` on each request. Cache in Postgres with `MATERIALIZED VIEW` if it gets slow.
- **`shows.fans` CSV export** — derived from `offers` JOIN `users` JOIN `seat_assignments`.
- **Distribution histogram** (ShowAdmin Distribution tab) — `SELECT width_bucket(price_per_ticket_cents, ...) ... GROUP BY bucket`.
- **"Recent activity"** in ShowAdmin Overview — derived from `allocation_logs ORDER BY created_at DESC LIMIT N`.

---

## Cross-table invariants

These are application-layer guarantees worth writing tests for:

1. `seat_assignments.charged_amount_cents = offers.price_per_ticket_cents * offers.group_size` when `is_binding = true` and `charged_amount_cents IS NOT NULL`.
2. `resales.artist_appreciation_cents = MAX(0, new_price_cents - original_price_cents)`.
3. `bond_events` rows for `offer_placed` / `show_attended` / `resale` always reference a real `offers.id` / `seat_assignments.id` / `resales.id` via `metadata`.
4. Sum of `seat_assignments` for a show ≤ `venue_architectures.rows[].capacity - manifest_holds - show_holds` for the active subset.
5. `offers.UNIQUE (show_id, user_id)` enforces Q16's "one offer per fan per show."

---

## Open questions blocking schema work

These need answers before Week 3 ships:

| # | Question | Cost of waiting | Recommend |
|---|---|---|---|
| **A** | Bleacher confirmed? (NEW-8) | Low — add columns now with safe defaults; drop if no | Ship columns; mark `bleacher_enabled DEFAULT false` |
| **B** | Card-failure recovery window (30 min vs 24h)? | Medium — affects Week 5 PaymentIntent retry job design | Decide before Week 5. Recommend 4h compromise. |
| **C** | `artist_members` join table for delegation? | Low if added now; expensive to retrofit | Ship now empty; only Cope uses it day one |
| **D** | Show-holds vs manifest-holds split? | Low | Ship both, document the lifecycle in a runbook |
| **E** | Bond `delta` computed at event-emit time? | Low | Yes; backfill if formula changes |
| **F** | Miracle gifting to non-AUCKETS-user email? | Medium — affects ResaleFlow UX | Email a signup-magic-link; collapses gift+signup into one flow |
| **G** | Slack routing for artist_requests? | Low | Skip at MVP; email-only |

None of these blocks the GAE engine work (already done). All of them inform Week 3 schema.

---

## What this plan does NOT cover

- **Drizzle types and helpers.** Translate this spec to `drizzle/schema.ts` in Week 3.
- **Migration ordering.** drizzle-kit handles that.
- **Seed data.** A separate `drizzle/seed.ts` slice — see [ROADMAP.md Week 3](ROADMAP.md).
- **Row-level security policies.** We're not using Supabase RLS (per [ARCHITECTURE.md](ARCHITECTURE.md)). Auth happens at the route handler.
- **Index tuning for production load.** Premature without traffic. Add when EXPLAIN tells us to.
