# Remaining work — cross-walk against the design

A snapshot of what's shipped vs what's not, organized by impact and blocker chain. Pair this with [`CONTEXT.md`](CONTEXT.md) ("Current state") and [`ROADMAP.md`](ROADMAP.md) (week-by-week plan).

Updated 2026-05-31 after PRs #68–#98 merged (TicketViewer + T-48h issuance, door Scanner, Stripe webhook, card-failure recovery, scheduled binding, displacement alerts, mobile-responsive pass, role-aware home, ShowCreate + inline venue create, VENUE_STAFF roles, fan email notifications, min-to-get-in tracker, **AllocationFinal #96**, **venue-builder UX #97**, **public /shows index #98**). Prior update 2026-05-28 covered #51–#67.

---

## TL;DR

**The read side, the full money path, and the full attend-path are shipped.** Real offer submission (Stripe manual-capture auth) → preview/binding allocation → capture-on-placement → ticket issuance → door scan all work end-to-end. We are **essentially beta-ready** — only soft gaps remain.

The road to **beta** is now down to one product decision (group cost-split) — the last ops blocker (fan email) closed 2026-06-11:

- 🔴 ~~**Hard blockers**~~ — **all shipped.** ~~TicketViewer~~ (front-end #68, signed rotating-token endpoint #69, T-48h issuance) and ~~Scanner~~ (VENUE_STAFF-gated `/scan` + `/api/scan` validating the rotating QR into the `ticket_scans` log). A beta fan can now get a ticket and through the door.
- 🟠 ~~**Strong blockers**~~ — **all shipped.** ~~Stripe webhook handler~~ (signed + idempotent `/api/stripe/webhook`), ~~CardFailure recovery~~ (backend + UI + the fan/ops failure email, #90), ~~scheduled binding~~ (Inngest cron sweeps due checkpoints).
- 🟡 **Soft gaps** — **all fan-journey screens now shipped.** ~~AllocationFinal~~ shipped (#96, `/allocation/[showId]`). ~~Turning fan email on~~ — **done 2026-06-11**: `auckets.com` is verified in Resend (DNS records re-created on Vercel DNS during the domain move) and `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set in the Vercel prod env. **ShowCreate UI** (#86) and the **fan email templates** (#90) are done.

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
| **TicketViewer.jsx** | ✅ Built | `src/components/ticket/TicketViewer.tsx` + `/api/tickets/[id]/token` | done (geo-gated rotating QR #68; server-signed token #69; tickets now issued T-48h). Live once a show is bound + within 48h of doors. |
| **ResaleFlow.jsx** | ❌ Not built (post-beta) | — | large (ADR-0014 anti-scalping mechanics) |
| **CardFailure.jsx** | ✅ Built | `src/components/show/CardFailureRecovery.tsx` on the fan Show page | done (banner + Elements modal → POST recover; backend + 4h window; "your card failed" fan email shipped #90) |
| **ArtistDashboard.jsx** | ✅ Close to fidelity | `src/app/(artist)/artists/[artistId]/page.tsx` | small (omitted "New show" button — depends on ShowCreate) |
| **ShowAdmin.jsx** | ✅ Tabbed shell + Run-binding button (#54, #65) | `src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx` | small–medium (Fans · data export tab pending) |
| **ShowCreate.jsx** | ✅ Built — full row/tier control | `src/app/(artist)/artists/[artistId]/shows/new/page.tsx` + `ShowCreateForm` + `POST /api/shows` | done (form + POST handler + `createShow` repo all landed this slice; earlier "POST exists" note was wrong — only GET existed) |
| **VenueBuilder.jsx** | ❌ Not built (post-beta) | — | large (rows, capacity, parity, lean, tier, holds builder). Inline generator now does typeable sizes, GA→single total-capacity, per-tier unit types (Rows/Tables/Boxes/GA/Custom, **labels only**), and Duplicate — see post-beta item 12 below for the atomic-seating + bulk-paste follow-ups. |
| **Allocation.jsx** | ❌ Not built (post-beta polish) | — | small–medium ("you're in the room" confirmation page after submit) |
| **AllocationFinal.jsx** | ✅ Built (#96) | `/allocation/[showId]` + `src/lib/presenters/allocation-final.ts` | done (fan "placed / not placed" result page after binding) |
| **Scanner.jsx** | ✅ Built | `/scan` + `src/components/scan/Scanner.tsx` | done (camera via BarcodeDetector + manual token fallback → `/api/scan`; VENUE_STAFF-gated). Geo-gating stays on the fan viewer. |

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

## Email templates (5 designed + card-failure)

| Template | Built in `src/lib/email/templates/`? | Wired to send? |
|---|---|---|
| `welcome.html` | ✅ welcome.tsx | ❌ no trigger |
| `offer-received.html` | ✅ OfferReceived.tsx (#90) | ✅ `POST /api/offers`, first submission |
| `placed.html` | ✅ OfferPlaced.tsx (#90) | ✅ `runBindingAllocation` |
| `not-placed.html` | ✅ OfferNotPlaced.tsx (#90) | ✅ `runBindingAllocation` |
| `allocation-imminent.html` | ✅ AllocationImminent.tsx (#90) | ✅ `allocation-imminent` job |
| _card-failure_ | ✅ CardFailure.tsx (#90) | ✅ `runBindingAllocation` (card-failure branch) |

`sendEmail()` (`src/lib/email/client.ts`) no-ops without `RESEND_API_KEY`. **As of 2026-06-11 the senders are LIVE in production:** `auckets.com` is verified in Resend and `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set in the Vercel prod env. (During the GoDaddy→Vercel DNS move the Resend DKIM/SPF records were re-created on Vercel DNS — they only existed in the old GoDaddy zone.)

---

## Cross-cutting systems

| System | Status | Notes |
|---|---|---|
| **Stripe / payments** | ✅ Live (real path) | Stripe SDK + `src/lib/stripe/` (client, `customers.ts`, `payment-intents.ts`, `webhook.ts`, `card-failure-recovery.ts`). `POST /api/offers` ensures a Customer and creates a manual-capture `PaymentIntent` to hold the auth (≤6-day window, ADR-0003). Elements card collection wired. Revision cancels prior intent + recreates. **Signed, idempotent webhook** at `/api/stripe/webhook` (receipts in `stripe_webhook_events`): `payment_intent.payment_failed` → `card_failure`, `succeeded` → `charged` backstop, `canceled` recorded. **Card-failure recovery (backend):** `POST /api/offers/[id]/recover` charges a new card within the 4h window (`recoverCardFailure`); the `card-failure-expiry` cron releases lapsed seats. **Gaps:** the recovery *UI modal* + fan/ops failure notification, no app-level offer-idempotency-table writes, dev stub remains as fallback only. |
| **Notifications — Resend (email)** | ✅ Live (2026-06-11) | `welcome` + `RequestActioned` + all 4 fan-lifecycle templates + card-failure built and wired (#90, `src/lib/notifications/fan.ts`). Senders are best-effort (each catches its own errors). Domain verified in Resend, `RESEND_API_KEY` + `RESEND_FROM_EMAIL` set in prod. **Watch the free-tier 100-emails/day cap** (see Platform plans & costs below). |
| **Notifications — Slack** | ⚠️ Scaffold wired (#50) | Ops alerts on request actions go out; broader coverage (card-failure, allocation-run) not wired. |
| **Notifications — Twilio / SMS** | ❌ Not built (post-beta) | ADR-0016 moved SMS to MVP. No Twilio SDK, no 10DLC registration. **Long pole** — 1–2 week carrier turnaround; can start registration anytime. |
| **Tickets** | ✅ Issuance + viewer + scanner live | `tickets` table + repo; **T-48h issuance** (`issueTicketsForDueShows`, `ticket-issuance` cron) mints a ticket + server-only `totp_secret` per paid seat of a bound show; the signed rotating-QR endpoint (#69) + geo-gated TicketViewer (#68) consume it; the door **Scanner** (#82) validates and admits it (`ticketScans` now written on every scan). Attend-path complete end-to-end. |
| **Scanner** | ✅ Live | `/scan` (VENUE_STAFF / AUCKETS_ADMIN gated via `userCanScan`) → `POST /api/scan` → `processTicketScan` verifies the rotating QR (`verifyTicketToken`), admits the ticket (status → `scanned`), and appends every scan to `ticketScans` (ok / replay / expired_token / invalid). Camera (BarcodeDetector) + manual fallback. |
| **Resales** | ❌ Not built (post-beta) | `resales` table exists; no refund logic, no artist-uplift routing, no Miracle Tickets gift flow. |
| **Binding allocation** | ✅ Live (#62) | `mode=binding` on the allocate route (`src/lib/allocation/run-binding.ts`) captures placed offers' PaymentIntents, cancels unplaced auths, transitions statuses. Triggered by an admin "Run binding" button (#65) **and** an Inngest cron (`scheduled-binding`, every 5 min) that sweeps shows whose `binding_allocation_at` has passed (`sweepDueBindings`). Paused shows are excluded — ops decides. |

---

## Platform plans & costs — audited 2026-06-11

Everything runs on free tiers today. Expected spend at beta: **~$65/mo + Stripe's per-transaction cut.** Three items are compliance/correctness issues disguised as billing, not optional upgrades. Pricing re-checked against each vendor's pricing page on the audit date.

| Platform | Plan today | Free ceiling that matters | Pay when / why |
|---|---|---|---|
| **Vercel** | Hobby | 100 GB transfer, 1M invocations, **4 CPU-hr/mo**, **non-commercial only** | **Pro $20/mo BEFORE public beta** — Hobby's ToS prohibits commercial use (selling tickets qualifies); the projection endpoint (in-memory GAE per dial move) will also burn the CPU allowance under real traffic |
| **Supabase** | Free (DB 11 MB / 500 MB) | 5 GB egress; **no automatic backups**; pauses after 1 wk inactivity (crons prevent this) | **Pro $25/mo BEFORE real money** — backups for the offers/charges/seats DB are the cheapest insurance in this table. Free tier allows 2 active projects, so the standing "separate prod project" split costs nothing extra |
| **Resend** | Free (domain verified, key set) | 3,000/mo and **100 emails/day**, 1 domain | **Pro $20/mo before the first show with >100 fans** — one "window closing" send to a 300-fan show hits the daily cap mid-send |
| **Clerk** | Free, **DEV instance** | 50k monthly users free | **$0** — but create the **production instance** before beta (dev instances lack production security features per Clerk's docs). Needs DNS records on auckets.com (now on Vercel DNS, CLI-addable) + `pk_live`/`sk_live` swap in Vercel. Pro ($25/mo) only if MFA/passkeys wanted |
| **Inngest** | Free (Hobby) | 50k executions/mo, 5 concurrent | Probably $0: the two 5-min crons are ~17k runs/mo baseline, but **steps count as executions** — check the usage dashboard after the first live week. Pro is $75/mo. Vendor is provisional per [OPEN_QUESTIONS NEW-19](OPEN_QUESTIONS.md) |
| **Stripe** | Test mode ($0) | n/a | **2.9% + 30¢ per successful charge** once live keys go in. No monthly fee. Stripe keeps its fee on refunds |
| **Sentry** | **DSN not set — errors go nowhere** | 5k errors/mo free | $0 — but `NEXT_PUBLIC_SENTRY_DSN` is absent from the Vercel prod env, contradicting NEW-7 ("high observability from day one"). Set it; free tier suffices |
| **Twilio** (future, ADR-0016) | Not started | n/a | ~$5–10/mo (number + A2P 10DLC campaign) + ~$0.008/SMS. The 10DLC carrier registration (1–2 wk) is the long pole, independent of cost |
| **GoDaddy** | Registrar only (~$20/yr renewal) | n/a | DNS now lives on Vercel (free). **Check whether the "Websites + Marketing" product that was squatting on the DNS is billing — it does nothing now; cancel it** |

Pre-beta upgrade order: **Vercel Pro** (ToS) → **Supabase Pro** (backups) → **Clerk production instance** ($0, work not money) → **Sentry DSN** ($0) → **Resend Pro** (the week before the first >100-fan show).

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
- ✅ **19-table Drizzle schema** including `offer_revisions`, `holds`, `stripe_webhook_events`, `displacement_events`, `offer_idempotency_keys`. RLS enabled deny-all on every public table.
- ✅ **Full attend-path** (#68–#82): T-48h ticket issuance → geo-gated rotating-QR TicketViewer → VENUE_STAFF door Scanner. A beta fan can get in.
- ✅ **Payment hardening** (#77–#80): signed/idempotent Stripe webhook + card-failure recovery (backend, UI banner/modal, 4h-window cron) + the card-failure fan email.
- ✅ **Fan lifecycle emails** (#90): offer-received / placed / not-placed / allocation-imminent / card-failure templates + senders wired to the offer + binding events (dormant until Resend domain verified).
- ✅ **Scheduled binding** (#78): Inngest cron sweeps shows past `binding_allocation_at` and runs binding automatically (paused shows excluded).
- ✅ **Displacement alerts** (#72–#76, ADR-0018): per-fan transitions persisted each preview/binding run + fan-facing alerts on the Show page.
- ✅ **Mobile-responsive pass** (#85), **role-aware home page** (#83), **ShowCreate form + inline venue create** (#86, #89), **VENUE_STAFF role management** (#87), **"minimum bid to get in" tracker** (#91).
- ✅ **CI gates:** typecheck + lint + ~518 unit tests + build on every PR, plus a parallel `integration` job that runs the real-Postgres suite (`tests/integration/`, 11 suites). Note: Vitest 4 transforms with **oxc**, so JSX runtime is set via `oxc: { jsx: { runtime: "automatic" } }` in both vitest configs (not `esbuild`) — see #94.

---

## Priority-ordered remaining work — the road to beta

Beta = real fans, real money, real attendance. The money path is done; the chain breaks *after* capture (fan can pay but can't get in the door). Ordered by what gates beta. Build order agreed with Julia 2026-05-28: **persona deep dive → hard → strong → soft**, with group cost-split slotted in after a product decision.

### 🔴 Hard blockers — a beta fan literally cannot attend without these

1. ~~**TicketViewer**~~ — ✅ **shipped.** Geo-gated 60s rotating QR (#68), server-signed token endpoint `/api/tickets/[id]/token` (#69), and T-48h issuance (`ticket-issuance` cron) that mints the ticket + `totp_secret`. The fan-facing viewer is live for any bound show within 48h of doors.
2. ~~**Scanner**~~ — ✅ **shipped.** `/scan` (VENUE_STAFF-gated) + `POST /api/scan` validate the rotating QR via `verifyTicketToken`, admit the ticket, and log every scan to `ticketScans` (ok / replay / expired / invalid). Camera (BarcodeDetector) with a manual token fallback. **Both hard blockers are now done** — the beta attend-path is complete end-to-end.

### 🟠 Strong blockers — money correctness/trust before real-money beta

3. ~~**Stripe webhook handler**~~ — ✅ **shipped.** Signed (`STRIPE_WEBHOOK_SECRET`) + idempotent (`stripe_webhook_events` receipts) handler at `/api/stripe/webhook`, acting on `payment_intent.payment_failed` / `succeeded` / `canceled`. Satisfies prime-directive #6.
4. ~~**CardFailure recovery**~~ — ✅ **shipped, including the notification.** Backend `recoverCardFailure` + `/api/offers/[id]/recover` + `card-failure-expiry` cron (4h window); fan-facing `CardFailureRecovery` banner + Stripe Elements modal on the Show page; and the "your card failed" fan email (#90) so a fan who isn't on the page learns to act within the window. **All three strong blockers are now done.**
5. ~~**Scheduled binding**~~ — ✅ **shipped.** Inngest cron (`scheduled-binding`, every 5 min) sweeps shows past their `binding_allocation_at` and runs binding (`sweepDueBindings`); the manual admin button remains. Paused shows excluded (ADR-0013).

### 🟡 Soft gaps — every fan-journey screen now shipped; remaining is ops + polish

6. ~~**Fan email templates**~~ — ✅ **shipped (#90) and sending (2026-06-11).** All 4 (offer-received, placed, not-placed, allocation-imminent) + card-failure built and wired in `src/lib/notifications/fan.ts`. The ops half is done: `auckets.com` verified in Resend, `RESEND_API_KEY` + `RESEND_FROM_EMAIL` set in the Vercel prod env.
7. ~~**AllocationFinal**~~ — ✅ **shipped (#96).** Fan "placed / not placed" result page at `/allocation/[showId]`, with `presentAllocationFinal`. **Every fan-journey screen is now built.**
8. ~~**ShowCreate UI**~~ — ✅ **shipped (#86, #89).** Full row/tier control form + `POST /api/shows` + `createShow` repo; inline "create venue" path generates a venue + seat map without leaving the form.
9. **Fans · data export tab** on ShowAdmin — per-fan rows + CSV + "Email all N". **Needs a privacy review first** per ADR-0017 (private offer fields are server-only). Manual export is the interim workaround.

### 🆕 New scope — group cost-split (needs product decision first)

10. **Group cost-split** — one person buys a group's tickets, then invites others to join the outing and split the cost. Materially changes the offer/payment model. Open product questions before any build: single PaymentIntent on the buyer with app-tracked splits vs. per-joiner auths? What happens if a joiner's split fails — does the buyer cover it? Does splitting affect rank (the offer is still one group at one price)? How do invites/joins work pre- vs. post-binding? **Capture as an OPEN_QUESTION + ADR before scoping slices.**

### 🔵 Post-beta — don't block on these

11. **Resale flow** — refund seller at original, route uplift to artist (ADR-0014). Miracle Tickets (gift) builds on this.
12. **VenueBuilder** — edit venue architecture (rows, capacity, parity, lean, tier). Needed before any *new* venue (Austin). The inline generator now also does typeable sizes, GA→single total-capacity, and per-tier **unit types** (Rows/Tables/Boxes/GA/Custom) + Duplicate — but two follow-ups remain:
    - **Atomic seating units (tables / boxes) in the GAE.** Unit types are **labels only** today — the GAE fills every unit seat-by-seat like a row, so a group of 4 at an 8-top leaves 4 seats for strangers and a group of 6 can split across a table boundary. True atomic behavior (one group per unit, no co-seating, over-capacity groups bump not split) is **blocked on a product decision** — see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) NEW-14 (protect empty seats vs. co-seat to fill). Touches `launchpad.ts` + `placement.ts`; needs new property tests ([GAE_SPEC.md](GAE_SPEC.md)).
    - **Bulk paste-and-parse tiers** from a spreadsheet (name, count, size, floor). Per-tier Duplicate shipped; bulk paste needs a column-format decision + parse-error handling.
13. **Twilio + SMS** — long pole (10DLC registration 1–2 weeks); start registration anytime.
14. **Allocation confirmation page** ("You're in the room" after submit) + **DisplacementToast** (needs polling/push).
15. **Header/nav** design-system polish, **Icon** system consolidation, **Sentry** DSN, **Stripe Connect Express** confirmation.
16. **Bond Phase 2** — `bond_events` ledger + auto-accept + rewards + fan profiles. Out of MVP scope per ROADMAP.

---

## Cope super-fan feedback (2026-06-04) — slice plan

Four asks from Cope, framed as "things a super fan would appreciate." **None blocks beta** — these are enhancements layered on the shipped attend-path. Full design notes in [OPEN_QUESTIONS.md NEW-15–NEW-18](OPEN_QUESTIONS.md#cope-super-fan-feedback-2026-06-04--design-needed); merch direction in [DECISIONS.md ADR-0019](DECISIONS.md#adr-0019--merch--limited-edition-drops-storefront-approach).

Two of the four are mostly *surfacing data we already have*; two are *net-new builds*. Suggested order is cheapest-and-highest-payoff first.

### A. Show / artist imagery (NEW-15) — net-new, contained · **suggested first**

Highest visual payoff, smallest build. Makes a poster appear on the `/shows` index, the show page, *and* the ticket stub.

- **Slice A1 — storage + schema + upload.** Pick storage in a short ADR (lean: Supabase Storage, public-read bucket, server-side writes via service role). Add `artists.imageUrl` + `shows.posterUrl` (nullable). New authenticated upload route (validate type/size). Wire upload UI into ShowCreate + a small artist-profile editor; admin can always upload.
- **Slice A2 — render everywhere.** Fallback chain show poster → artist photo → text placeholder, applied to: `/shows` index cards, fan show-detail hero, the ticket stub, the artist page header. (Could fold into A1 if small.)
- **Decision needed:** is the per-show poster override needed for show #1, or is an artist photo enough to start? (NEW-15.)

### B. Fan-facing venue seat map (NEW-16) — mostly surfacing · **needs Cope clarification**

The venue model + a `VenuePreview` already exist. ⚠️ "Load venue seating" is ambiguous — confirm with Cope which he means before building:

- **(a)** richer fan-facing interactive seat map on the show page — *Slice B1: extend `VenuePreview` to render the full active architecture with tiers.*
- **(b)** "your seat" highlighted on the ticket / `AllocationFinal` — *Slice B2: seat-highlight on the ticket stub + result page.*
- **(c)** importing a venue's real chart — that's the **existing VenueBuilder track** (post-beta item 12 + Q23/Q24), not new work.

Most likely (a)+(b). Hold slices until Cope confirms.

### C. Ticket manifest (NEW-17) — surfacing; admin half is unblocked

Data is all present (`seat_assignments` + `tickets` + `ticketScans`).

- **Slice C1 — admin/ops manifest. UNBLOCKED (Q30 = "Auckets sees everything").** A Tickets/Manifest section in the admin command center: per-fan rows (email/phone/group/offer/seats/ticket+scan status) + CSV export. Builds on the command-center initiative above. No new product decision.
- **Slice C2 — artist manifest. BLOCKED on a privacy decision.** Q30 limits the artist to "totals + averages per section," and ADR-0017 keeps private-offer fields server-only — so what an *artist* sees per-fan (de-identified? names only? full contact?) must be settled with Cope first. This is the long-deferred "Fans · data" tab (item 9 above).

### D. Merch / limited-edition drops (NEW-18) — net-new commerce subsystem · **biggest, needs ADR decision**

Captured as **[ADR-0019](DECISIONS.md#adr-0019--merch--limited-edition-drops-storefront-approach) (Proposed)**. No slices until the direction (native-on-Stripe vs. Shopify) and Cope's product answers (drop mechanics, super-fan gating, inventory/variants, fulfilment, payout/fees, tax) land. Sketch once decided:

- **If native (Direction A), scoped tiny for drop #1:** *Slice D1* — products/variants/inventory/orders schema + immediate-capture PaymentIntent with Connect application fee. *Slice D2* — storefront + cart + checkout UI, gated to ticket-holders, pickup-at-show (no shipping/tax) using the existing door scanner. *Slice D3+* — shipping/addresses/tax if/when merch grows into a shipped catalog.
- **If Shopify (Direction B):** ops stands up the store; *Slice D1* — identity bridge for super-fan gating + embed-vs-link-out; minimal `show ↔ shopify_collection` link.

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
