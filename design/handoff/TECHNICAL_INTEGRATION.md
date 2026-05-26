# Auckets — Technical Integration Guide

**Audience.** A developer (or Claude Code session) implementing the
Auckets product on top of the existing repo at
[`ShuaLuke/auckets`](https://github.com/ShuaLuke/auckets).

**Scope.** Every prototype screen in this design system → its target
file in the Next.js codebase, the API endpoints it calls, the database
tables it reads/writes, and the third-party services it touches.

**Status.** Authoritative *intent*. Where this document and the
prototype HTML disagree, **this document wins** — the HTML is a tool
to explore visuals; this is the spec.

> See also: [`README.md`](./README.md) for visual foundations and copy
> guidelines, [`handoff/README.md`](./handoff/README.md) for the
> Tailwind/CSS install steps, and the product model
> (`AUCKETS_Product_Model_v1.docx`) which is the source of truth for
> *what* the platform does.

---

## 1. Stack assumptions

The codebase already pins:

| Layer            | Choice                                                            |
|---|---|
| Framework        | Next.js 14 (App Router)                                            |
| Runtime          | Node.js (Vercel hosting)                                           |
| Language         | TypeScript                                                         |
| UI               | React 18.3, Tailwind 3.4                                           |
| Auth             | Clerk (`@clerk/nextjs`)                                            |
| DB ORM           | Drizzle                                                            |
| DB               | Postgres (Neon / Supabase / similar)                               |
| Payments         | Stripe (SetupIntent + PaymentIntent + Connect)                     |
| Email            | `@react-email/components` + Resend (or Postmark)                   |
| SMS              | Twilio (proposed — confirm with Cope)                              |
| Background jobs  | **Inngest** (proposed) for scheduled allocation, T−1h reminders   |
| Realtime         | Server-sent events or Pusher (proposed)                            |
| Icons            | `lucide-react@0.469.0`                                             |
| Fonts            | Bricolage Grotesque, Geist, JetBrains Mono via Google Fonts        |

**Items proposed by this doc (not yet in `package.json`).** Confirm
with Cope before adding:

- `inngest` (scheduled jobs)
- `twilio` (SMS)
- `qrcode` (QR rendering on the fan ticket page)
- `otplib` (TOTP token generation, RFC 6238)
- `pusher` or `pusher-js` (real-time placement updates) — *or* use SSE

---

## 2. Database schema

The codebase's `drizzle/` directory should hold these. Mostly mirrors
`docs/CONTEXT.md` and `docs/GAE_SPEC.md` but adds the tables needed for
ticket viewer, resale, Bleacher, Bond, and audit.

### Core tables

```sql
-- 2.1 USERS — Clerk is the source of truth for auth, but we mirror.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,            -- Clerk user id
  email           TEXT NOT NULL UNIQUE,
  phone           TEXT,                        -- E.164, captured at signup
  stripe_customer_id TEXT,
  bond_score      INTEGER DEFAULT 0,           -- see § 8
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.2 ARTISTS
CREATE TABLE artists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  stripe_connect_id TEXT,                      -- Stripe Connect account
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.3 VENUES
CREATE TABLE venues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  city            TEXT,
  geo_lat         NUMERIC(9,6),                -- center coordinate
  geo_lon         NUMERIC(9,6),
  geo_radius_m    INTEGER DEFAULT 500,         -- for ticket gating
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.4 VENUE_ARCHITECTURES — versioned per-show seat maps
CREATE TABLE venue_architectures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID REFERENCES venues(id),
  version         INTEGER NOT NULL,
  rows            JSONB NOT NULL,              -- see § 2.6 below
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (venue_id, version)
);

-- 2.5 SHOWS
CREATE TABLE shows (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id                UUID REFERENCES artists(id),
  venue_id                 UUID REFERENCES venues(id),
  venue_architecture_id    UUID REFERENCES venue_architectures(id),
  doors_at                 TIMESTAMPTZ NOT NULL,
  offer_window_opens_at    TIMESTAMPTZ NOT NULL,
  binding_allocation_at    TIMESTAMPTZ NOT NULL,  -- typically doors - 24h
  status                   TEXT NOT NULL DEFAULT 'draft',  -- draft|open|closed|allocated|complete
  tier_floors_cents        JSONB NOT NULL,        -- { premium: 4000, mid: 1800, rear: 1000 }
  bleacher_enabled         BOOLEAN DEFAULT false,
  bleacher_capacity        INTEGER DEFAULT 0,
  bleacher_price_cents     INTEGER DEFAULT 1500,
  created_at               TIMESTAMPTZ DEFAULT now()
);
```

### 2.6 Venue row shape (JSONB inside `venue_architectures.rows`)

```json
[
  {
    "id":          "row_aa_orch",
    "name":        "AA",
    "area":        "orchestra",
    "tier":        "premium",
    "row_rank":    2,
    "capacity":    20,
    "parity":      "EVEN",
    "lean":        "CENTER",
    "holds":       [{ "seat_numbers": [1,2,19,20], "source": "ADA", "mutable": false }]
  }
]
```

### Offer + allocation tables

```sql
-- 2.7 OFFERS — both market and Bleacher channels share this table.
CREATE TABLE offers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id                  UUID REFERENCES shows(id),
  user_id                  TEXT REFERENCES users(id),
  channel                  TEXT NOT NULL,        -- 'market' | 'bleacher'
  group_size               INTEGER NOT NULL,
  price_per_ticket_cents   INTEGER NOT NULL,
  tier_preference          TEXT NOT NULL,        -- 'specific'|'this_or_worse'|'this_or_better'|'any'
  preferred_tier           TEXT,                 -- when tier_preference != 'any'
  rank_key                 BIGINT GENERATED ALWAYS AS
                            (price_per_ticket_cents::BIGINT * 1000 + group_size) STORED,
  auto_bid_enabled         BOOLEAN DEFAULT false,
  auto_bid_cap_cents       INTEGER,
  stripe_payment_method_id TEXT NOT NULL,        -- saved card token
  stripe_setup_intent_id   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pool',  -- pool|placed|unplaced|charged|refunded|resold
  submitted_at             TIMESTAMPTZ DEFAULT now(),
  revised_at               TIMESTAMPTZ,
  UNIQUE (show_id, user_id)                      -- one offer per fan per show
);

CREATE INDEX offers_show_pool_idx ON offers (show_id, status, rank_key DESC);

-- 2.8 SEAT_ASSIGNMENTS — output of allocation
CREATE TABLE seat_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id            UUID REFERENCES offers(id) UNIQUE,
  show_id             UUID REFERENCES shows(id),
  venue_row_id        TEXT NOT NULL,             -- matches venue_architectures.rows[].id
  seat_numbers        INTEGER[] NOT NULL,        -- e.g. {7,9,11,13}
  tier                TEXT NOT NULL,
  is_binding          BOOLEAN DEFAULT false,
  stripe_payment_intent_id TEXT,
  charged_amount_cents    INTEGER,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 2.9 ALLOCATION_LOGS — append-only audit log
CREATE TABLE allocation_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id       UUID REFERENCES shows(id),
  action        TEXT NOT NULL,                    -- PLACED|FIT_RESOLVED|SKIPPED|MANUAL_OVERRIDE|RUN_START|RUN_END
  offer_id      UUID REFERENCES offers(id),
  venue_row_id  TEXT,
  seat_numbers  INTEGER[],
  reason        TEXT,
  metadata      JSONB,
  mode          TEXT,                             -- 'preview' | 'binding'
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX allocation_logs_show_idx ON allocation_logs (show_id, created_at DESC);

-- 2.10 ARTIST_REQUESTS — comps, pauses, overrides logged here
CREATE TABLE artist_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id      UUID REFERENCES shows(id),
  requested_by TEXT REFERENCES users(id),
  kind         TEXT NOT NULL,                    -- 'comp'|'override'|'pause'|'end_early'
  details      TEXT NOT NULL,
  status       TEXT DEFAULT 'open',              -- 'open'|'executed'|'denied'
  executed_by  TEXT,
  executed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 2.11 TICKETS — issued post-binding, holds the seed for the rotating QR
CREATE TABLE tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_assignment_id  UUID REFERENCES seat_assignments(id) UNIQUE,
  user_id             TEXT REFERENCES users(id),
  totp_secret         TEXT NOT NULL,             -- base32-encoded, 30 char
  status              TEXT DEFAULT 'issued',     -- 'issued'|'scanned'|'resold'|'gifted'
  scanned_at          TIMESTAMPTZ,
  scanned_by_staff_id TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 2.12 RESALES — secondary market with capped appreciation
CREATE TABLE resales (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id               UUID REFERENCES tickets(id),
  original_offer_id       UUID REFERENCES offers(id),
  new_offer_id            UUID REFERENCES offers(id),
  original_price_cents    INTEGER NOT NULL,
  new_price_cents         INTEGER NOT NULL,
  artist_appreciation_cents INTEGER NOT NULL,   -- new - original, never negative
  kind                    TEXT NOT NULL,        -- 'resale' | 'miracle'
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- 2.13 BOND_EVENTS — append-only loyalty ledger (Phase 2 scoring TBD)
CREATE TABLE bond_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT REFERENCES users(id),
  artist_id   UUID REFERENCES artists(id),
  kind        TEXT NOT NULL,    -- 'offer_submitted'|'offer_placed'|'show_attended'|'resale'|'miracle_given'|'integrity_flag'
  show_id     UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 3. API surface

Every prototype interaction maps to one of these endpoints. All under
`src/app/api/`. Use the Zod-validated route handler pattern from
`docs/CONVENTIONS.md`.

### 3.1 Fan endpoints

| Method | Path                                  | Body / params                                                 | Notes |
|---|---|---|---|
| `POST` | `/api/offers`                         | `{ showId, channel, groupSize, pricePerTicketCents, tierPreference, preferredTier?, autoBidEnabled?, autoBidCapCents?, paymentMethodId }` | Creates an offer. Wraps a Stripe `SetupIntent`. Rate-limit one per `(showId, userId)`. |
| `PATCH`| `/api/offers/:id`                     | `{ pricePerTicketCents }` (UPWARD ONLY)                       | Reject if `< current.pricePerTicketCents`. Recompute `rank_key`. Broadcast preview update. |
| `DELETE` | `/api/offers/:id`                   | —                                                              | **Reject** before binding (offer is binding on submit). Only path to "leave" is resale. |
| `GET`  | `/api/shows/:id/preview`              | —                                                              | Returns the current user's projected seat assignment. SSE preferred over polling. |
| `GET`  | `/api/shows/:id/aggregates`           | —                                                              | `{ totalOffers, medianPriceCents, topPriceCents, provisionalFilled, capacity }`. Fan-safe view (no individual offers). |
| `POST` | `/api/tickets/:id/token`              | `{ lat, lon }`                                                | Issues a TOTP-rotated ticket token. Rejects if outside `venue.geo_radius_m`. |
| `POST` | `/api/resales`                        | `{ ticketId, kind: 'resale'|'miracle', recipient? }`           | Creates a resale row, returns the original ticket to the pool, refunds the seller. |

### 3.2 Artist endpoints

| Method | Path                                          | Body                                                        | Notes |
|---|---|---|---|
| `POST` | `/api/shows`                                  | `{ artistId, venueId, doorsAt, offerWindowDays, tierFloorsCents, bleacher }` | Creates a draft show. |
| `PATCH`| `/api/shows/:id`                              | partial                                                     | Edit floors, dates, etc. |
| `POST` | `/api/shows/:id/allocation/preview`           | —                                                            | Triggers a preview allocation run. Idempotent. Computed in-process or queued via Inngest. |
| `POST` | `/api/shows/:id/allocation/bind`              | —                                                            | Triggers binding allocation. **Should only be called by Inngest cron at T-24h, not by humans.** |
| `GET`  | `/api/shows/:id/admin`                        | —                                                            | Returns full distribution, allocation log, fan data. Artist-scoped. |
| `GET`  | `/api/shows/:id/fans.csv`                     | —                                                            | CSV export — every offer-submitter with email, phone, status. |
| `POST` | `/api/shows/:id/requests`                     | `{ kind, details }`                                          | Files an `artist_request`. |

### 3.3 Admin endpoints

| Method | Path                                          | Body                                                        | Notes |
|---|---|---|---|
| `POST` | `/api/venues/:id/architectures`               | `{ rows: [...] }`                                            | Versions the manifest; previous versions remain immutable. |
| `POST` | `/api/artist_requests/:id/execute`            | `{ notes }`                                                  | Ops executes a request. Writes to `allocation_logs` with `action=MANUAL_OVERRIDE`. |

### 3.4 Venue staff endpoints

| Method | Path                                          | Body                                                        | Notes |
|---|---|---|---|
| `POST` | `/api/tickets/scan`                           | `{ token, staffId }`                                         | Validates a TOTP token against `tickets.totp_secret`. Idempotent — second scan returns `already_scanned`. |

### 3.5 Webhooks

| Source  | Path                       | Purpose |
|---|---|---|
| Clerk   | `/api/webhooks/clerk`      | `user.created` → insert into `users`, capture phone, fire welcome email |
| Stripe  | `/api/webhooks/stripe`     | `payment_intent.payment_failed` → flip seat assignment to recovery state, send SMS + email |
| Inngest | (functions, not webhooks)  | Scheduled binding allocation, T−1h imminent, T−48h ticket release |

---

## 4. Screen → file map

This is the **canonical mapping** from each prototype to its target
file. Use it to drive a Claude Code implementation session.

| Prototype                                           | Target file in `auckets` repo                                  | Notes |
|---|---|---|
| `screens/Landing.jsx`                               | `src/app/page.tsx`                                              | Server component. Marketing only — no auth needed. |
| `screens/SignUpModal.jsx`                           | Clerk's hosted modal via `<SignUpButton mode="modal">`         | Replace prototype with Clerk; capture `phone` on first sign-in via custom field. |
| `screens/Dashboard.jsx`                             | `src/app/(fan)/dashboard/page.tsx`                              | Server component fetches shows; client component for hover. |
| `screens/Show.jsx`                                  | `src/app/(fan)/shows/[showId]/page.tsx`                         | Mostly client (composer state); SSE for preview updates. |
| `screens/Allocation.jsx`                            | `src/app/(fan)/shows/[showId]/offer/page.tsx`                   | Post-submit confirmation. |
| `screens/AllocationFinal.jsx`                       | `src/app/(fan)/shows/[showId]/result/page.tsx`                  | Post-binding. Branch on existence of `seat_assignments` for this `(show, user)`. |
| `screens/TicketViewer.jsx`                          | `src/app/(fan)/tickets/[ticketId]/page.tsx`                     | Client. Geolocation + 60s TOTP cycle. |
| `screens/ResaleFlow.jsx`                            | `src/app/(fan)/tickets/[ticketId]/resale/page.tsx`              | Client. |
| `screens/CardFailure.jsx`                           | `src/components/CardFailureDialog.tsx`                          | Triggered from dashboard on Stripe webhook flag. |
| `screens/ArtistDashboard.jsx`                       | `src/app/(artist)/page.tsx`                                     | Server + client mix. |
| `screens/ShowAdmin.jsx` (Overview/Distribution/Placement/Holds/Fans tabs) | `src/app/(artist)/shows/[showId]/page.tsx` | Big screen. The 5 tabs can be separate route segments or in-page tab state — recommend in-page since they share the show context. |
| `screens/ShowCreate.jsx`                            | `src/app/(artist)/shows/new/page.tsx`                           | — |
| `screens/VenueBuilder.jsx`                          | `src/app/(admin)/venues/[venueId]/page.tsx`                     | Two-pane editor. |
| `screens/Scanner.jsx`                               | `src/app/(venue)/scan/[showId]/page.tsx`                        | Client only. Uses `getUserMedia` for camera + a QR decoder lib like `jsQR`. |

### Route groups (Clerk middleware)

`src/middleware.ts` should gate the route groups by role:

```ts
// pseudo-config
{
  publicRoutes: ['/', '/api/webhooks/(.*)'],
  protectedRoutes: ['/dashboard', '/shows/(.*)', '/tickets/(.*)'],
  roles: {
    artist: ['/^/(artist)/'],
    admin:  ['/^/(admin)/'],
    venue:  ['/^/(venue)/'],
  },
}
```

Add `publicMetadata.role` to Clerk users (`'fan'|'artist'|'admin'|'venue_staff'`).

---

## 5. Allocation engine integration

The Greenwood Allocation Engine is specified in
`docs/GAE_SPEC.md` in the codebase. **The prototype doesn't run it
— the prototype has synthetic preview math** (`computePreview` in
`Show.jsx`). When you implement, replace that with a real GAE call.

```ts
// pseudo-code
import { runAllocation } from '@/lib/gae';

// preview = idempotent, doesn't write
const preview = await runAllocation({
  showId,
  mode: 'preview',
  // includes the requesting fan's offer as if it were in the pool
});

// binding = writes seat_assignments + charges cards
const binding = await runAllocation({
  showId,
  mode: 'binding',
  triggeredBy: 'inngest_cron',  // or 'artist_request' for end-early
});
```

The GAE should:
1. Lock the offer pool (advisory lock on `show_id`).
2. Walk rows by `row_rank`.
3. For each row, solve the fit problem (greedy or constrained knapsack).
4. For each placement, write to `seat_assignments` + log to `allocation_logs`.
5. In `binding` mode, create Stripe `PaymentIntent`s using saved
   `payment_method_id`. Roll back on any failure; place that offer
   in a recovery queue (see § 6).
6. Release the lock.

Preview runs should be ≤ 200ms for 142 offers — well within real-time.

---

## 6. Payments — the SetupIntent / PaymentIntent flow

This is the meaty integration. Pulled directly from product model § 5
and `docs/CONTEXT.md`.

### 6.1 Offer submission

```ts
// POST /api/offers
const setupIntent = await stripe.setupIntents.create({
  customer: user.stripe_customer_id,
  payment_method_types: ['card'],
  usage: 'off_session',
});
// Returns client_secret to frontend; frontend collects card with
// Stripe Elements, confirms the SetupIntent, sends payment_method_id
// back to /api/offers/confirm.
```

We save the `payment_method_id` on the offer row. **No charge, no hold,
no auth.** This sidesteps Stripe's 7-day auth expiration.

### 6.2 Binding allocation charge

```ts
// At T-24h, inside the GAE's binding mode:
const paymentIntent = await stripe.paymentIntents.create({
  amount: offer.price_per_ticket_cents * offer.group_size,
  currency: 'usd',
  customer: user.stripe_customer_id,
  payment_method: offer.stripe_payment_method_id,
  off_session: true,
  confirm: true,
  // Route the artist's share via Stripe Connect:
  transfer_data: { destination: artist.stripe_connect_id },
  application_fee_amount: calculatePlatformFee(...),  // TBD per § 5
});
```

### 6.3 Failure recovery (the `CardFailure.jsx` flow)

When a PaymentIntent fails:
1. Stripe webhook fires `payment_intent.payment_failed`.
2. We mark `seat_assignments.charged_amount_cents = NULL` and add a
   `card_failure_at` timestamp.
3. **30-minute hold begins** — the seat is reserved for this user but
   not for anyone else.
4. Fan gets email + SMS with a deep link to update their card.
5. If they re-charge a new payment method within 30 minutes, they
   keep the seats. Otherwise, the GAE runs a re-allocation for that
   row from the next-best unplaced offers.

---

## 7. Rotating geo-gated QR ticket

Product model § 6. The fan ticket viewer (`TicketViewer.jsx`).

### 7.1 Token generation

```ts
import * as otp from 'otplib';

// Generate at ticket-issue time:
const secret = otp.authenticator.generateSecret();  // 32-char base32
await db.insert(tickets).values({ totp_secret: secret, ... });

// At display time (POST /api/tickets/:id/token):
const token = otp.authenticator.generate(secret);   // 6 digits, 30s window
const qrPayload = JSON.stringify({ ticketId, token, ts: Date.now() });
const qrSvg = await QRCode.toString(qrPayload, { type: 'svg' });
return { qrSvg, secondsUntilRotation: 30 - (Math.floor(Date.now()/1000) % 30) };
```

Rotate the client-side QR every cycle. The prototype shows a 60s
cycle for visual clarity; **production should use the RFC 6238
standard 30s window** unless Cope wants otherwise.

### 7.2 Geo gating

```ts
// Browser-side, on opening /tickets/:id:
const pos = await navigator.geolocation.getCurrentPosition(...);

// POST /api/tickets/:id/token with { lat, lon }:
const distance = haversine(
  { lat: venue.geo_lat, lon: venue.geo_lon },
  { lat, lon }
);
if (distance > venue.geo_radius_m) {
  return res.status(403).json({ reason: 'too_far', distance_m: distance });
}
```

**Don't store the fan's coordinates** beyond the request. Per copy
("Auckets never stores your precise location"). Log only `passed/failed`
plus distance, not the lat/lon itself.

### 7.3 Backup procedures

If location is denied or phone is dead, venue staff can look up the
fan by name + government ID at the door (`POST /api/tickets/scan` with
`{ staffOverride: true, lookupName }`). All overrides logged.

---

## 8. The Bond ledger

Product model § 8. **Phase 2** — capture events from day one, score
later.

Append a `bond_events` row whenever:
- A user submits an offer (`kind: 'offer_submitted'`)
- A user's offer is placed (`kind: 'offer_placed'`)
- A user is scanned in at the door (`kind: 'show_attended'`)
- A user gifts a Miracle Ticket (`kind: 'miracle_given'`)
- A user does a resale (`kind: 'resale'`)
- An integrity flag fires (`kind: 'integrity_flag'` — chargebacks, no-shows, etc.)

Each event carries `(user_id, artist_id, show_id, metadata)`. The
scoring formula and conversion to allocation priority are deferred.
Just don't lose the events.

---

## 9. Real-time updates (live placement preview)

The `Show.jsx` projected placement updates as other offers come in.
Two implementation options:

### Option A — Server-Sent Events (simpler)
```ts
// GET /api/shows/:id/preview-stream
// Emits { type: 'preview_update', placement, totalOffers, median } whenever
// the offer pool for show_id changes.
```

Trade-off: SSE doesn't reconnect great on iOS Safari.

### Option B — Pusher / Ably (robust)
```ts
// Channel: `show-${showId}`
// Event: 'preview_update'
```

Trade-off: extra dependency, ~$30/mo at our scale.

**Recommendation.** Start with SSE; switch to Pusher if iOS retention
becomes an issue for the beta.

---

## 10. Background jobs (Inngest)

The product has three kinds of scheduled work:

| Trigger                    | What it does                                                   |
|---|---|
| `show.opened`              | Send "offers open" email to fans following the artist          |
| Cron `T−24h before doors`  | Run binding allocation, charge cards, send placed/not-placed emails |
| Cron `T−1h before doors`   | Send "allocation imminent" SMS to all current offer holders     |
| Cron `T−48h before doors`  | Issue tickets, generate TOTP secrets, send "tickets ready"      |
| `offer.displaced`          | Send outbid email/SMS, optionally fire auto-bid                |
| `payment_intent.failed`    | Start 30-minute recovery window, send SMS + email              |
| `T+1h after doors`         | Mark show complete, append `show_attended` bond events         |

Define each in `src/inngest/functions/`. Inngest will retry failed
runs with backoff — important for the binding allocation cron, which
must succeed.

---

## 11. Design-side flags for deployment

Things that are correct in the prototype but will need to flex when
hooked to real data. **Read these before shipping.**

### 11.1 Synthetic data to remove

- `SHOWS` array in `Dashboard.jsx`, `ARTIST_SHOWS` in `ArtistDashboard.jsx`,
  `INITIAL_ROWS` in `VenueBuilder.jsx`, `FAN_ROWS` in `ShowAdmin.jsx` —
  all synthetic. Replace with real DB queries.
- `computePreview` in `Show.jsx` — placeholder math. **Must** be
  replaced with a real GAE call before going live.
- The "Distribution" histogram in `ShowAdmin.jsx` uses a fixed array.
  Replace with a SQL query bucketed by `price_per_ticket_cents`.

### 11.2 Visual choices that should hold up

- All color / type / spacing tokens — production-ready.
- All copy — final (modulo Cope's review of FAQ + landing).
- Header height (57px) is the Tailwind border-bottom assumption already
  in the codebase. **Don't change it without updating sticky-top
  offsets in `Show.jsx` (the composer sidebar uses `top: 80`).**

### 11.3 Mobile breakpoints — **not yet designed**

The prototype is desktop-first. Before MVP launch, design needs to
adapt:
- The 380px composer sidebar on `Show.jsx` → stacks above the venue
  preview at <900px.
- The `ShowAdmin.jsx` 4-tab layout → tabs become a `<select>` at <700px.
- The fan `TicketViewer.jsx` is already mobile-shaped (max-width 480).
- The `Scanner.jsx` is built for tablet portrait — confirm with the
  device venues will actually use.

### 11.4 Accessibility audit needed

- Color contrast: `--marquee-500` on `--paper` is 3.1:1 — borderline.
  Use `--marquee-700` for text on light surfaces.
- The QR ticket's `<details>` accordions in Landing need explicit
  `aria-expanded`.
- The Stepper component should be keyboard-navigable; currently it's
  click-only.
- All icon-only buttons need `aria-label` (already there in the kit,
  preserve when porting).

### 11.5 Lucide icon coverage

The prototype uses these. Verify each exists in `lucide-react@0.469.0`
when porting:

```
ticket calendar arrow-right arrow-left chevron-right check x plus
minus mail apple map-pin map-pin-off info refresh-cw gift trending-down
pause zap message-square trash-2 upload download search alert-triangle
check-circle x-circle door-open qr-code
```

If any are missing or renamed in the installed version, swap to the
nearest available — same stroke weight, same fill style.

### 11.6 Font licensing

**Bricolage Grotesque and Geist are Google-Fonts loaded.** Confirm
this is acceptable for production:
- Bricolage Grotesque: SIL Open Font License (free for commercial).
- Geist: SIL Open Font License (free for commercial).
- JetBrains Mono: SIL Open Font License.

If we want the fonts hosted from our own CDN (faster, less Google
dependency), self-host: download from `fonts.google.com`, drop in
`/public/fonts/`, replace `@import` in `globals.css` with
`@font-face` declarations.

### 11.7 Logo placeholder

The wordmark and ticket-stub mark in `/assets/` are **text-set and
hand-drawn placeholders**. Replace with the real Auckets logo when it
lands. Likely sites to update:
- `<Header>` wordmark text (currently HTML text)
- `<TicketViewer>` corner mark
- Email header (currently HTML text)
- `<head>` favicon and apple-touch-icon
- Landing footer wordmark

### 11.8 Beta-only flags to consider

For the first beta show:
- **No public artist signup** — `/api/shows` requires admin role.
  Cope's the only artist for now.
- **Bleacher off by default** — only enable for the bigger theater test.
- **No real Miracle Tickets** — disable the gift button on first beta.
  Resale should also start disabled.
- **SMS off until Twilio is set up** — email-only notifications for beta 1.

---

## 12. Test fixtures

The prototype's synthetic data is a good seed for `drizzle/seed.ts`.
Pull these into a fixture file:

```ts
// drizzle/seed.ts
export const FIXTURE_VENUES = [
  { name: 'Lincoln Theatre', city: 'Washington, DC',
    geo_lat: 38.9173, geo_lon: -77.0306, geo_radius_m: 500,
    rows: /* INITIAL_ROWS from VenueBuilder.jsx */ },
];
export const FIXTURE_SHOWS = [
  /* SHOWS from Dashboard.jsx */
];
```

---

## 13. Suggested implementation order

For a Claude Code session:

1. **Foundation** — paste `handoff/tailwind.config.additions.ts` and
   `handoff/globals.css`. Verify the wordmark renders.
2. **Components library** — Button, Card, Field, TextInput, Badge,
   Eyebrow, Header. Match the prototype 1:1.
3. **DB migration** — write the Drizzle schema from § 2.
4. **Auth flow** — Clerk modal with phone capture.
5. **Marketing landing** — replace `src/app/page.tsx`.
6. **Fan dashboard + offer composer + allocation** — the core loop.
   Real DB, synthetic GAE.
7. **Real GAE** — implement `runAllocation()` per `docs/GAE_SPEC.md`.
8. **Stripe SetupIntent + PaymentIntent** — at this point it's real money.
9. **Ticket viewer + TOTP** — fan can see their seats.
10. **Resale + Miracle** — anti-scalping story.
11. **Artist surfaces** — dashboard + show admin + create show.
12. **Admin venue builder** — manifest editing.
13. **Door scanner** — venue staff surface.
14. **Email + SMS templates** — port the 5 emails.
15. **Inngest functions** — scheduled allocation, T−1h SMS, T−48h tickets.
16. **Mobile** — design pass + implementation.
17. **Accessibility audit + fixes.**

Each step is a single PR per the repo's working norms. Tests per
`docs/CONVENTIONS.md`.

---

## 14. Open questions for Cope

These aren't blockers, but answers will sharpen the build:

1. **Bleacher proportion default.** 5% of capacity? 10%? Per-show or a
   platform default? (Prototype assumes 40 seats / ~6%.)
2. **Auto-bid increment.** Default $5? User-configurable? (Prototype assumes $5.)
3. **Platform fee structure.** Per ticket, percentage, or zero? Surface to
   artist in `ShowCreate.jsx` if needed.
4. **SMS gateway.** Twilio confirmed? Or Postmark/Resend SMS?
5. **Realtime infra.** SSE acceptable for beta, or set up Pusher now?
6. **Geo radius default.** 500m? Per-venue configurable in admin?
7. **Logo direction.** Wordmark only, or wordmark + mark? Color
   treatment (ink only, or with Greenwood)?
8. **Artist data export PII.** OK to include phone numbers? Email
   only? Comply with regional rules (we should consult counsel).
