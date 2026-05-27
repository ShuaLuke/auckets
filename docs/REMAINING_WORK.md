# Remaining work — cross-walk against the design

A snapshot of what's shipped vs what's not, organized by impact and blocker chain. Pair this with [`CONTEXT.md`](CONTEXT.md) ("Current state") and [`ROADMAP.md`](ROADMAP.md) (week-by-week plan).

Updated 2026-05-27 after PR #45 (slice 11) merged.

---

## TL;DR

**Roughly 25–30% of the prototype is shipped, all on the read side.** Everything that touches money, real ticket delivery, scanning, resales, or notifications is unbuilt.

**Single biggest blocker:** ADR-0003 (Stripe SetupIntent hold-window). Cope is still researching. Until it settles, real money cannot flow — and the entire chain downstream of that (binding allocation → real tickets → scanner → card-failure recovery → resale) is blocked behind it.

---

## Screen cross-walk (14 screens in `design/ui_kits/auckets/screens/`)

| Screen | Status | Path | Effort to finish |
|---|---|---|---|
| **Landing.jsx** | Stub | `src/app/page.tsx` (32 lines, logo + signup button) | small–medium |
| **SignUpModal.jsx** | ✅ Functional via Clerk | `/sign-in`, `/sign-up` (Clerk's built-in modal, not the prototype style) | cosmetic only |
| **Dashboard.jsx** (fan) | ✅ Close to fidelity | `src/app/(fan)/dashboard/page.tsx` | small (microcopy polish) |
| **Show.jsx** (fan show detail) | ⚠️ Works via dev stub | `src/app/(fan)/shows/[showId]/page.tsx` | medium (live preview, venue map, rank board on the right column) |
| **TicketViewer.jsx** | ❌ Not built | — | large (ADR-0015: rotating TOTP QR + geo gate) |
| **ResaleFlow.jsx** | ❌ Not built | — | large (ADR-0014 anti-scalping mechanics) |
| **CardFailure.jsx** | ❌ Not built | — | medium (blocked on Stripe being in) |
| **ArtistDashboard.jsx** | ✅ Close to fidelity | `src/app/(artist)/artists/[artistId]/page.tsx` | small (omitted "New show" button — depends on ShowCreate) |
| **ShowAdmin.jsx** | ✅ Most of it shipped | `src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx` | small–medium (Fans · data export tab pending) |
| **ShowCreate.jsx** | ❌ Not built | — | medium (form + `POST /api/shows`) |
| **VenueBuilder.jsx** | ❌ Not built | — | large (rows, capacity, parity, lean, tier, holds builder) |
| **Allocation.jsx** | ❌ Not built | — | small–medium ("you're in the room" confirmation page after submit) |
| **AllocationFinal.jsx** | ❌ Not built | — | medium (fan "placed / not placed" result page after binding) |
| **Scanner.jsx** | ❌ Not built | — | large (door-staff scan app; paired with TicketViewer) |

---

## Design components → UI primitives

Located at `src/components/ui/`. Most are ported; two notable gaps:

| Design component | Status |
|---|---|
| `Button` | ✅ ported (primary, brand, secondary, ghost, inverse) |
| `Field`, `TextInput`, `Stepper`, `RadioGroup` | ✅ ported |
| `Card` | ✅ ported (default, warm, sunken, inverse, outline variants) |
| `Badge` | ✅ ported (placed/preview/pending/skipped/unplaced/open/upcoming/inverse) |
| `Eyebrow` | ✅ ported |
| `Tag` | ⚠️ inlined inside `HoldsCard`, not promoted to a shared primitive |
| `Header` / nav | ❌ Not ported. `src/app/layout.tsx` hand-rolls a header with Clerk buttons; the design's role-switcher + nav structure isn't reproduced |
| `Icon` set | ❌ Not ported as a unit. We import individual lucide-react icons ad-hoc instead of using the design's named icon set |

---

## Email templates (5 designed)

| Template | Built in `src/lib/email/templates/`? | Wired to send? |
|---|---|---|
| `welcome.html` | ✅ welcome.tsx | ❌ no trigger |
| `offer-received.html` | ❌ | ❌ |
| `placed.html` | ❌ | ❌ |
| `not-placed.html` | ❌ | ❌ |
| `allocation-imminent.html` | ❌ | ❌ |

`sendEmail()` exists in `src/lib/email/client.ts` but stays dormant without `RESEND_API_KEY`. No Inngest job or route handler currently calls it for any user-facing event.

**Effort:** medium — 4 React Email components + 4 trigger points + verify auckets.com domain in Resend.

---

## Cross-cutting systems

| System | Status | Notes |
|---|---|---|
| **Stripe / payments** | ❌ Not built | No Stripe SDK import, no SetupIntent, no webhook handler, no payment-method storage. **Blocked on ADR-0003** (Cope's hold-window decision). Offer submission goes through a dev stub that fakes `stripe_payment_method_id` and `stripe_setup_intent_id`. |
| **Notifications — Resend (email)** | ⚠️ Client wired, dormant | 1 of 5 templates exists; nothing fires today. |
| **Notifications — Slack** | ❌ Not built | No webhook integration. Internal ops alerts (card failures, allocation runs, artist requests) have no notification path. |
| **Notifications — Twilio / SMS** | ❌ Not built | ADR-0016 moved SMS to MVP. No Twilio SDK, no 10DLC registration. **Long pole** — 1–2 week carrier turnaround. |
| **Tickets** | ⚠️ Data only | Schema has the `tickets` table, repositories can read tickets and present seat assignments. No QR generation, no rotating-token logic, no geo-validation, no fan-facing ticket viewer. |
| **Scanner** | ❌ Not built | Door-entry app; paired with TicketViewer. Needs `VENUE_STAFF` role (per ADR-0012, added for Austin). |
| **Resales** | ❌ Not built | No resale schema events, no refund logic, no artist-uplift routing, no Miracle Tickets gift flow. |
| **Binding allocation job** | ❌ Not built | `POST /api/shows/[id]/allocate?mode=binding` returns 501. The engine runs preview-only today. |

---

## What IS live (positive context)

Comprehensive read-side coverage + the bid-submit dev stub. From the prototype:

- ✅ The full **fan-side bid flow** end-to-end on Vercel preview deploys (real submit on Vercel production refuses until ADR-0003 settles)
- ✅ The full **artist-side ShowAdmin** experience minus the Fans tab — including BigStats, recent activity (with live GAE decisions interleaved), tier breakdown, distribution histogram, provisional placement seat map, holds & manifest (read-only)
- ✅ The full **/my-bids fan history** with offer-revision history (every change to every offer captured by `offer_revisions` inside the upsert transaction)
- ✅ **Admin-only "Preview allocation" button** that runs the real GAE end-to-end and refreshes the page with new placements
- ✅ **Artist request action** dialog and endpoint for pause/end-early/comp/override per ADR-0013 (admin-side execution is the next slice)
- ✅ **GAE itself** — all five modules complete and tested (types, rank-key, launchpad, fit-resolver, placement, waterfall, allocate() entry point)
- ✅ **17-table Drizzle schema** including the newly added `offer_revisions` and `holds`. RLS enabled deny-all on every public table.
- ✅ **CI gates:** typecheck + lint + 343 unit tests + build, four gates on every PR

---

## Priority-ordered remaining work

### 🟢 Unblocked admin/artist polish — small slices, no external dependencies

These can ship at any time, in any order. Each is a 1-PR slice.

1. **Admin inbox UI** for ops to execute / deny `artist_requests` (the filing side ships; the execute side is open). Server-component page at `/admin/requests`, AUCKETS_ADMIN-gated, per-request execute/deny endpoints. *In progress at handoff time.*
2. **Add hold dialog + DELETE** flow. Schema is ready (`holds` table, `kind='venue'|'artist'`). Need: POST/DELETE endpoints + client dialog (similar shape to RequestActionButton) + trash icon wired up. Range compaction in seat-number formatting ("1-4" for contiguous) can land here too.
3. **Revision diffs in the activity feed.** Activity feed currently shows "Revision · offer_xxxx · now $40 × 4". `presentOfferHistory` already builds "$30 → $40" diffs for /my-bids. Pull `listOfferRevisionsByOfferIds` into the ShowAdmin page and pair adjacent revisions in `presentRecentActivity`.
4. **Fans · data export tab** on ShowAdmin (the Fans tab from `ShowAdmin.jsx`). Per-fan rows with email/phone/group/offer/status/seats + CSV export + "Email all N" action. **Needs a privacy review first** per ADR-0017 (private offer fields are server-only — confirm what's safe to expose).

### 🟡 Blocked operationally — start whenever external work clears

5. **Notifications wiring**:
   - Resend domain verification (`auckets.com` in Resend) — operational
   - 4 missing email templates (offer-received, placed, not-placed, allocation-imminent)
   - Slack webhook for #ops (request-filed, card-failure, allocation-run alerts)
   - Twilio + SMS (long pole: 10DLC registration is 1–2 weeks of carrier turnaround)
6. **ShowCreate** — form + `POST /api/shows` so Cope (or any artist) can create a show without engineering help.
7. **VenueBuilder** — surface for editing venue architecture (rows, capacity, parity, lean, tier). Needed before any new venue (Austin, etc.).

### 🔴 Blocked on ADR-0003 — Cope's Stripe hold-window research

These cannot move until ADR-0003 settles. They're listed in dependency order.

8. **Real `POST /api/offers` with SetupIntent** — replaces the dev stub. Idempotency keys (table already exists), Stripe SetupIntent, payment-method storage.
9. **Binding allocation job** — `mode=binding` path on `/api/shows/[id]/allocate`. Converts a preview into PaymentIntent captures + offer.status transitions + show.status transitions.
10. **Inngest schedule** for binding allocation at the announced checkpoint (T-24h before doors).
11. **TicketViewer** — rotating TOTP QR (60s rotation per ADR-0015) + geolocation gate. Fan-facing route at `/tickets/[id]` or similar.
12. **Scanner** — door-staff app. Camera/QR scan UI, scan log, attendance recording. `VENUE_STAFF` role gating per ADR-0012.
13. **CardFailure recovery** — 2% card-failure window. Notification, retry, hold-the-seat logic.
14. **Resale flow** — refund seller at original, route uplift to artist (ADR-0014). Miracle Tickets (gift mode) builds on this primitive.
15. **AllocationFinal** — fan-facing "placed / not placed" result page after a binding run.

### 🔵 Polish (any time, post-MVP)

16. **Landing page** full build-out — hero, "How it works," FAQ, marketing copy.
17. **Header / nav redesign** — role-switcher, design-system header.
18. **Icon system** consolidation — promote `Icon` as a shared primitive instead of ad-hoc lucide-react.
19. **Allocation confirmation page** ("You're in the room" after submit).
20. **Bond Phase 2** — `bond_events` table + ledger + auto-accept + rewards + fan profiles. Out of MVP scope per ROADMAP.

---

## How to use this doc

When a slice ships:
1. Move the relevant item from a 🔴/🟡 section up to the "What IS live" list.
2. Update `CONTEXT.md` "Current state" if the change is meaningful (new page, new schema table, new external service).
3. Update `ROADMAP.md` checkboxes for the relevant week.

When a new external service or decision lands:
1. Move the relevant 🔴 items to 🟡 or 🟢.
2. Note in `OPEN_QUESTIONS.md` that the question is resolved and link to the ADR.

When in doubt, the order to evaluate priorities is: **safety (RLS / auth / Stripe correctness) → bid-flow operability → polish.**
