# Remaining work — cross-walk against the design

A snapshot of what's shipped vs what's not, organized by impact and blocker chain. Pair this with [`CONTEXT.md`](CONTEXT.md) ("Current state") and [`ROADMAP.md`](ROADMAP.md) (week-by-week plan).

Updated 2026-05-28 after PRs #51–#67 merged (real Stripe path, binding allocation, run-binding button, role nav, landing rebuild, ShowAdmin tabbed shell, admin shows list).

---

## TL;DR

**The read side and the full money path are shipped.** Real offer submission (Stripe manual-capture auth) → preview/binding allocation → capture-on-placement all work. We are **past alpha**.

The gap to **beta** is the back half of the fan journey plus payment hardening, in three buckets:

- 🔴 **Hard blockers** — a beta fan cannot attend without these: **TicketViewer** + **Scanner**.
- 🟠 **Strong blockers** — money correctness/trust: ~~**Stripe webhook handler**~~ (✅ shipped — signed + idempotent `/api/stripe/webhook`), **CardFailure recovery**, ~~**scheduled binding**~~ (✅ shipped — Inngest cron sweeps due checkpoints).
- 🟡 **Soft gaps** — beta-tolerable with manual workarounds: 4 fan email templates, **AllocationFinal**, **ShowCreate UI**.

**ADR-0003 (2026-05-27):** ≤6-day offer windows + auth-based hold is still a working assumption (Julia), **not yet Cope-confirmed**. The money path is built against it; if his research lands on windows >6 days, revisit the PaymentIntent path. See the 2026-05-27 note in [DECISIONS.md ADR-0003](DECISIONS.md#adr-0003--stripe-setupintent--charge-on-acceptance).

**New scope (2026-05-28):** group cost-split — one buyer pays, invites others to join the outing and split the cost. Materially changes the offer/payment model; needs a product decision / ADR before build (see the dedicated item below).

---

## Screen cross-walk (14 screens in `design/ui_kits/auckets/screens/`)

| Screen | Status | Path | Effort to finish |
|---|---|---|---|
| **Landing.jsx** | ✅ Rebuilt to fidelity (#53) | `src/app/page.tsx` | done (copy polish only) |
| **SignUpModal.jsx** | ✅ Functional via Clerk | `/sign-in`, `/sign-up` (Clerk's built-in modal, not the prototype style) | cosmetic only |
| **Dashboard.jsx** (fan) | ✅ Close to fidelity | `src/app/(fan)/dashboard/page.tsx` | small (microcopy polish) |
| **Show.jsx** (fan show detail) | ✅ Real Stripe submit + RankBoard + PreviewBanner/VenuePreview (#55, #56, #59–#61) | `src/app/(fan)/shows/[showId]/page.tsx` | small (DisplacementToast needs polling/push — follow-up) |
| **TicketViewer.jsx** | ❌ Not built — 🔴 **hard blocker** | — | large (ADR-0015: rotating TOTP QR + geo gate) |
| **ResaleFlow.jsx** | ❌ Not built (post-beta) | — | large (ADR-0014 anti-scalping mechanics) |
| **CardFailure.jsx** | ❌ Not built — 🟠 **strong blocker** | — | medium (Stripe is in; needs webhook + recovery flow) |
| **ArtistDashboard.jsx** | ✅ Close to fidelity | `src/app/(artist)/artists/[artistId]/page.tsx` | small (omitted "New show" button — depends on ShowCreate) |
| **ShowAdmin.jsx** | ✅ Tabbed shell + Run-binding button (#54, #65) | `src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx` | small–medium (Fans · data export tab pending) |
| **ShowCreate.jsx** | ❌ UI not built — 🟡 **soft gap** (`POST /api/shows` exists) | — | medium (form on top of existing route) |
| **VenueBuilder.jsx** | ❌ Not built (post-beta) | — | large (rows, capacity, parity, lean, tier, holds builder) |
| **Allocation.jsx** | ❌ Not built (post-beta polish) | — | small–medium ("you're in the room" confirmation page after submit) |
| **AllocationFinal.jsx** | ❌ Not built — 🟡 **soft gap** | — | medium (fan "placed / not placed" result page after binding) |
| **Scanner.jsx** | ❌ Not built — 🔴 **hard blocker** | — | large (door-staff scan app; paired with TicketViewer) |

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
| **Stripe / payments** | ✅ Live (real path) | Stripe SDK + `src/lib/stripe/` (client, `customers.ts`, `payment-intents.ts`, `webhook.ts`). `POST /api/offers` ensures a Customer and creates a manual-capture `PaymentIntent` to hold the auth (≤6-day window, ADR-0003). Elements card collection wired. Revision cancels prior intent + recreates. **Signed, idempotent webhook** at `/api/stripe/webhook` (receipts in `stripe_webhook_events`): `payment_intent.payment_failed` → `card_failure`, `succeeded` → `charged` backstop, `canceled` recorded. **Gaps:** CardFailure *recovery* flow (the webhook records the failure; retry/notify is a separate slice — 🟠), no app-level offer-idempotency-table writes, dev stub remains as fallback only. |
| **Notifications — Resend (email)** | ⚠️ Client + ops scaffold wired | `welcome` + `RequestActioned` templates exist; ops (Slack/Resend) notification on request actions fires (#50). 4 fan-facing templates still missing; `auckets.com` not yet verified in Resend. |
| **Notifications — Slack** | ⚠️ Scaffold wired (#50) | Ops alerts on request actions go out; broader coverage (card-failure, allocation-run) not wired. |
| **Notifications — Twilio / SMS** | ❌ Not built (post-beta) | ADR-0016 moved SMS to MVP. No Twilio SDK, no 10DLC registration. **Long pole** — 1–2 week carrier turnaround; can start registration anytime. |
| **Tickets** | ⚠️ Data + read only — 🔴 **hard blocker** | `tickets`/`ticketScans` tables + read repo (`src/lib/db/repositories/tickets.ts`) exist. No QR generation, no rotating-token logic, no geo-validation, no fan-facing viewer. |
| **Scanner** | ❌ Not built — 🔴 **hard blocker** | Door-entry app; paired with TicketViewer. Needs `VENUE_STAFF` role (per ADR-0012, added for Austin). |
| **Resales** | ❌ Not built (post-beta) | `resales` table exists; no refund logic, no artist-uplift routing, no Miracle Tickets gift flow. |
| **Binding allocation** | ✅ Live (#62) | `mode=binding` on the allocate route (`src/lib/allocation/run-binding.ts`) captures placed offers' PaymentIntents, cancels unplaced auths, transitions statuses. Triggered by an admin "Run binding" button (#65) **and** an Inngest cron (`scheduled-binding`, every 5 min) that sweeps shows whose `binding_allocation_at` has passed (`sweepDueBindings`). Paused shows are excluded — ops decides. |

---

## What IS live (positive context)

Comprehensive read-side coverage **plus the full real-money path**. From the prototype:

- ✅ The full **fan-side bid flow** end-to-end with **real Stripe** — manual-capture `PaymentIntent` holds the card auth on submit; revising cancels the prior intent and recreates. Elements card collection wired into the composer. (Dev stub remains only as a no-Stripe fallback.)
- ✅ **Binding allocation** — `mode=binding` captures placed offers' PaymentIntents and releases unplaced auths, driven by an admin "Run binding" button on ShowAdmin.
- ✅ **Stripe Customer attach** so saved-card reuse can build on it later.
- ✅ **Landing page** rebuilt to design fidelity; **role-aware site nav**; **`/admin` command-center shows list** + requests inbox.
- ✅ The full **artist-side ShowAdmin** in a tabbed shell minus the Fans tab — including BigStats, recent activity (with live GAE decisions interleaved + revision diffs), tier breakdown, distribution histogram, provisional placement seat map, holds & manifest, RankBoard + PreviewBanner/VenuePreview on the fan show-detail right column
- ✅ The full **/my-bids fan history** with offer-revision history (every change to every offer captured by `offer_revisions` inside the upsert transaction)
- ✅ **Admin-only "Preview allocation" button** that runs the real GAE end-to-end and refreshes the page with new placements
- ✅ **Artist request action** dialog and endpoint for pause/end-early/comp/override per ADR-0013 (admin-side execution is the next slice)
- ✅ **GAE itself** — all five modules complete and tested (types, rank-key, launchpad, fit-resolver, placement, waterfall, allocate() entry point)
- ✅ **17-table Drizzle schema** including the newly added `offer_revisions` and `holds`. RLS enabled deny-all on every public table.
- ✅ **CI gates:** typecheck + lint + ~392 unit tests + build on every PR, plus a parallel `integration` job that runs the real-Postgres suite (`tests/integration/`, currently covering `upsertOfferForUser` + the artist-request concurrency guard)

---

## Priority-ordered remaining work — the road to beta

Beta = real fans, real money, real attendance. The money path is done; the chain breaks *after* capture (fan can pay but can't get in the door). Ordered by what gates beta. Build order agreed with Julia 2026-05-28: **persona deep dive → hard → strong → soft**, with group cost-split slotted in after a product decision.

### 🔴 Hard blockers — a beta fan literally cannot attend without these

1. **TicketViewer** — rotating-TOTP QR (60s per ADR-0015) + geolocation gate, fan-facing (route ~`/tickets/[id]`). `tickets` table + read repo exist; QR generation, rotating-token logic, geo-validation, and the viewer UI do not. Per ADR-0015 this is the *only* ticket format — no static printable fallback.
2. **Scanner** — door-staff scan app paired with TicketViewer. Camera/QR scan UI, scan log, attendance recording, `VENUE_STAFF` role gating (ADR-0012).

### 🟠 Strong blockers — money correctness/trust before real-money beta

3. ~~**Stripe webhook handler**~~ — ✅ **shipped.** Signed (`STRIPE_WEBHOOK_SECRET`) + idempotent (`stripe_webhook_events` receipts) handler at `/api/stripe/webhook`, acting on `payment_intent.payment_failed` / `succeeded` / `canceled`. Satisfies prime-directive #6.
4. **CardFailure recovery** — the 2% capture-failure case (`payment_intent.payment_failed`). Notification + retry + hold-the-seat logic. Less common with auth-based holds (card already validated) but auths can be cancelled between auth and capture.
5. ~~**Scheduled binding**~~ — ✅ **shipped.** Inngest cron (`scheduled-binding`, every 5 min) sweeps shows past their `binding_allocation_at` and runs binding (`sweepDueBindings`); the manual admin button remains. Paused shows excluded (ADR-0013).

### 🟡 Soft gaps — beta-tolerable with a manual workaround

6. **Fan email templates** — 4 missing (offer-received, placed, not-placed, allocation-imminent) + verify `auckets.com` in Resend. Without these, beta fans get no "you're placed" email. (`welcome` + `RequestActioned` exist; ops Slack/Resend scaffold fires on request actions.)
7. **AllocationFinal** — fan "placed / not placed" result page after a binding run.
8. **ShowCreate UI** — `POST /api/shows` exists; needs a form so shows aren't seeded by SQL. Fine to seed by hand for one beta show.
9. **Fans · data export tab** on ShowAdmin — per-fan rows + CSV + "Email all N". **Needs a privacy review first** per ADR-0017 (private offer fields are server-only).

### 🆕 New scope — group cost-split (needs product decision first)

10. **Group cost-split** — one person buys a group's tickets, then invites others to join the outing and split the cost. Materially changes the offer/payment model. Open product questions before any build: single PaymentIntent on the buyer with app-tracked splits vs. per-joiner auths? What happens if a joiner's split fails — does the buyer cover it? Does splitting affect rank (the offer is still one group at one price)? How do invites/joins work pre- vs. post-binding? **Capture as an OPEN_QUESTION + ADR before scoping slices.**

### 🔵 Post-beta — don't block on these

11. **Resale flow** — refund seller at original, route uplift to artist (ADR-0014). Miracle Tickets (gift) builds on this.
12. **VenueBuilder** — edit venue architecture (rows, capacity, parity, lean, tier). Needed before any *new* venue (Austin).
13. **Twilio + SMS** — long pole (10DLC registration 1–2 weeks); start registration anytime.
14. **Allocation confirmation page** ("You're in the room" after submit) + **DisplacementToast** (needs polling/push).
15. **Header/nav** design-system polish, **Icon** system consolidation, **Sentry** DSN, **Stripe Connect Express** confirmation.
16. **Bond Phase 2** — `bond_events` ledger + auto-accept + rewards + fan profiles. Out of MVP scope per ROADMAP.

---

## 🔎 From 2026-05-27 design-vs-shipped audit — mostly resolved

Five UI-fidelity gaps surfaced in the 2026-05-27 audit. Status as of 2026-05-28:

1. **Landing page rebuild** — ✅ shipped (#53), to design fidelity.
2. **ShowAdmin tabbed shell** — ✅ shipped (#54).
3. **Show detail right column — `RankBoard`** — ✅ shipped (#55).
4. **Show detail right column — `PreviewBanner` + `VenuePreview`** — ✅ shipped (#56). `DisplacementToast` (the 3rd component) still deferred — needs polling/push; lives in the post-beta bucket above.
5. **ArtistDashboard cell re-align** — partial. *Capacity filled* (cross-show seat-capacity aggregate) shippable now; *Provisional payout* needs Stripe fee math — now unblocked since the payment path is live, but not yet built.

---

## Admin command center (initiative)

Today `/admin` is a single inbox (`/admin/requests`). The goal is to grow it into the startup's operational cockpit — the one place ops watches and acts on everything the data model already supports. Two audiences, one surface: **a non-technical operator (Julia) should be able to navigate it without a map, while a technical user can drill into raw snapshot/log detail.** Build it incrementally — the shows list is the spine; everything else hangs off a per-show drill-down or its own section.

The data already supports far more than messages. Sections, roughly in priority order:

| Section | What ops watches / does | Source tables |
|---|---|---|
| **Shows** (spine) | Every show + window state, offer/ticket counts, allocation status; drill into one show | `shows`, `seatAssignments` |
| **Offers** | All offers across shows — placed/unplaced, amounts, auto-bid, search by fan | `offers`, `offerRevisions` |
| **Tickets** | Issued tickets, scan status, resales in flight | `tickets`, `ticketScans`, `resales` |
| **Money** | Holds (auth'd PaymentIntents), captures, bond events | `holds`, `bondEvents` |
| **Allocations** | Each binding run's full snapshot/log — what the GAE decided and why | `allocationLogs` |
| **Requests** | (the inbox shipped today) | `artistRequests` |
| **People** | Users/artists, roles | `users`, `artists` |
| **Simulation** | What-if allocation runs against live/synthetic pools. **Julia has a Claude-design outline for this tab — pull it in before building.** | GAE (preview mode) |

Design principles to carry through every slice:
- **Progressive disclosure.** Summary numbers up top, raw JSON snapshots / logs behind a "dive deeper" toggle — so the non-technical default stays clean and the technical path is one click in.
- **Read-then-act.** Each section starts read-only; actions (capture a hold, cancel an offer, force a re-run) layer on once the view is trusted. Actions re-check authorization server-side regardless of nav visibility.
- **Reuse presenters/repos.** Cross-artist admin views are the same shapes as the artist-scoped views, just unscoped — don't fork the formatting.

First slice shipped: the **Shows list** at `/admin` (all shows, all statuses, each row → existing ShowAdmin). Remaining sections above are unbuilt and unordered beyond the priority hint.

## How to use this doc

When a slice ships:
1. Move the relevant item from a 🔴/🟡 section up to the "What IS live" list.
2. Update `CONTEXT.md` "Current state" if the change is meaningful (new page, new schema table, new external service).
3. Update `ROADMAP.md` checkboxes for the relevant week.

When a new external service or decision lands:
1. Move the relevant 🔴 items to 🟡 or 🟢.
2. Note in `OPEN_QUESTIONS.md` that the question is resolved and link to the ADR.

When in doubt, the order to evaluate priorities is: **safety (RLS / auth / Stripe correctness) → bid-flow operability → polish.**
