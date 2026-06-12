# Open Questions

What is not yet decided, what was just decided, and what's new since the last
revision.

This file is the **working list** for the repo. The deeper analysis behind each
entry lives in the consolidated v2 working doc Julia maintains
(`AUCKETS_Open_Questions_v2.docx`); when a decision is large enough to drive
code, it also gets its own ADR in [`DECISIONS.md`](DECISIONS.md) — those are
referenced inline below.

---

## At a glance

| Status              | Count |
|---|---|
| Open blocker        | 4     |
| Open high-priority  | 14    |
| Phase 2 (deferred)  | 7     |
| Resolved in v2      | 24    |

Last full revision: **2026-05-25**, based on Julia + Cope answers in
`AUCKETS_Open_Questions_v2.docx`. NEW-9–NEW-13 added **2026-05-28** from the
persona audit ([PERSONAS.md](PERSONAS.md)) + Julia's group cost-split and
functional-auto-bid/alerts requests. NEW-10 decided (ops-only + auto-run).
NEW-15–NEW-18 added **2026-06-04** from Cope's super-fan feedback (show imagery,
fan-facing venue seat map, ticket manifest, merch drops); merch is captured as
[ADR-0019](DECISIONS.md#adr-0019--merch--limited-edition-drops-storefront-approach)
(Proposed — direction not yet chosen).

---

## Open blockers — answers needed before the affected feature ships

### Q19 — Per-section floor pricing
**Affects:** Pricing schema, artist dashboard, [GAE_SPEC](GAE_SPEC.md).
**Working assumption:** Yes — different floors per section. Schema supports it.
**Status:** Cope: "to be decided." Schema is forward-compatible; UI work blocked until confirmed.

### Q20 — Platform fee model
**Affects:** Stripe Connect configuration, artist payout calculation.
**Working assumption:** Configurable application-fee percentage, default 0% for the first show.
**Status:** Cope: "need to do further analysis." Don't ship a non-zero fee without confirmation.

### Q23 — Who builds venue architecture
**Affects:** Operational process, tooling priorities.
**Working assumption:** AUCKETS team builds the first 3 venues manually. Importer tool is Phase 1.5.
**Status:** No code blocker, but the operational answer affects who's on the hook for Cope's place + the Austin theater.

### Q24 — Venue manifest format
**Affects:** Importer design (Phase 1.5).
**Working assumption:** Internal canonical format is JSON matching the `VenueRow` schema. Translate from whatever venues provide manually for MVP.
**Status:** Folded into Q23 operationally.

### NEW-1 — Stripe hold strategy (length of offer window)
**Affects:** [ADR-0003](DECISIONS.md#adr-0003--stripe-setupintent--charge-on-acceptance).
**Working assumption (2026-05-27, Julia):** **Offer windows ≤6 days + auth-based hold** (`PaymentIntent` with `capture_method: "manual"`). Within Stripe's 7-day reliable-auth window for most card networks. Captured at binding allocation; auth released for unplaced offers. See the 2026-05-27 note in ADR-0003 for the full implementation path.
**Status:** Not confirmed by Cope yet. Locked in as a working assumption to unblock downstream development (real `POST /api/offers`, binding, tickets, scanner, resale). Subsequent slices can build against this; if Cope eventually wants windows >6 days we revert to the SetupIntent path documented in the ADR body and revisit the slices built against the assumption.

---

## Open high-priority — needed before the affected feature

### Q1 — HFC codebase read access
**Status:** Still open. If not granted within 5 business days of asking, treat AUCKETS as greenfield (we already are, in practice).

### Q6 — HFC tech-lead handover call
**Status:** A 60-minute call would surface useful undocumented context (Stripe Connect config, seed data quirks, edge cases). If not possible, get the same info in writing.

### Q37b — Per-show email customization workflow
**Affects:** Email templates, artist dashboard, ops.
**Working assumption (per Cope):** Auckets sends emails, but works with the artist before each show to customize per-show copy.
**Status:** Need to design the "customization handoff" — is it a doc Auckets fills in for each show, a form in the artist dashboard, a one-off process per show? Decide before Week 6 (artist dashboard).

### NEW-8 — Bleacher channel (proportion + per-show vs platform default)
**Source:** Surfaced by the design system's `TECHNICAL_INTEGRATION.md`. **Not yet addressed by Cope.**
**Affects:** Schema (`offers.channel`), pricing, artist dashboard.
**Working assumption:** None yet. The design doc proposes ~6% of capacity at a fixed price.
**Status:** Defer until Cope weighs in. If yes, schema needs `channel`; if no, drop the concept and simplify.

### NEW-9 — Can a fan withdraw an offer?
**Source:** 2026-05-28 persona audit ([PERSONAS.md](PERSONAS.md) fan #5).
**Affects:** OfferComposer, `POST /api/offers` (or a new DELETE), offer status model, Stripe auth release.
**Working assumption:** None. Today the composer only submits/revises and the rule is "revise upward, never downward" — there is no exit. This may be an intentional commitment device.
**Status (2026-05-28, Julia):** **Defer the real decision to Cope.** Interim: keep no-withdrawal, but make the behavior explicit to the fan in the composer copy so it isn't a silent dead-end. If Cope later allows withdrawal it must release the held PaymentIntent auth and define the cutoff (presumably the binding checkpoint).

### NEW-10 — Preview allocation: ops-only or artist self-serve?
**Source:** 2026-05-28 persona audit ([PERSONAS.md](PERSONAS.md) artist #2).
**Affects:** ShowAdmin (`canRunPreview`), artist vs admin authorization.
**Working assumption (as built):** Ops-only — ShowAdmin passes `canRunPreview={isAdmin}`, so an artist viewing their own show can't run a preview and sees only what an admin last ran (or an empty placement map).
**Status (2026-05-28, Julia): DECIDED — ops-only + auto-run. ✅ SHIPPED.** Preview stays an ops/admin action (`canRunPreview={isAdmin}`); the show view auto-runs an in-memory preview projection so artists never see a stale/empty map, and only the explicit ops "Run preview"/"Run binding" actions persist `seat_assignments` + `allocation_logs`. Persisting run = system of record; auto-run = read-time projection, exactly as specified.

### NEW-11 — Per-show tier naming vs. hardcoded "Premium"
**Source:** 2026-05-28 persona audit ([PERSONAS.md](PERSONAS.md) fan #3).
**Affects:** OfferComposer tier radios, show detail view, venue tier model.
**Working assumption (as built):** Tier labels are hardcoded ("Premium only / Premium or below") and the payload always sends `preferredTier = "premium"`. Correct for the single seeded alpha show; misleading for any venue not built around a tier literally named "premium."
**Status:** Needs the venue's tier list surfaced in the show view so the composer renders real tier names. Tied to VenueBuilder / venue-architecture work. Until then, fine for the current alpha venue only.

### NEW-12 — Group cost-split (one buyer, joiners split the cost)
**Source:** Julia, 2026-05-28.
**Affects:** Offer/payment model, Stripe (single PaymentIntent + split tracking vs. per-joiner auths), invites/joins, rank semantics.
**⚠️ Distinct from NEW-6.** NEW-6 ("group splits never acceptable for MVP, no `accept_split`") ruled out **seat splitting** — the GAE never seating a group across non-adjacent seats. NEW-12 is **cost splitting** — one fan submits/holds the offer for the group, then invites others to join the outing and pay their share. Different concept; needs its own confirmation. **Cope should confirm cost-split doesn't run against the spirit of NEW-6 before any build.**
**Working assumption:** None. Open design questions: single PaymentIntent on the buyer with app-tracked splits, or per-joiner auths? If a joiner's share fails, does the buyer cover it? Does splitting affect rank (the offer is still one group at one price)? How do invites/joins work pre- vs. post-binding? Needs its own ADR once the model is chosen.
**Status:** New. Capture now; do not scope slices until the model + Cope's confirmation land.

### NEW-13 — Functional auto-bid + fan displacement alerts (incl. custom alerts)
**Source:** Julia, 2026-05-28 (persona audit follow-up — wants auto-bid built for real, not hidden, plus fan alerts on displacement).
**Affects:** ADR-0017 (auto-bid), the preview/binding compute path, notifications (Resend/Twilio/in-app), DisplacementToast, OfferComposer.
**The shared core — "displacement detection":** when the offer pool changes, recompute provisional placement, diff it per-fan (rank drop / section change / fell out of the event entirely), then (a) auto-raise auto-bidders toward their cap, and (b) fire alerts. Today auto-bid is collected but inert — the allocation layer strips `autoBidEnabled`/`autoBidCapCents` (`translate.test.ts:140-141`).
**Design captured in [ADR-0018](DECISIONS.md#adr-0018--displacement-engine-auto-bid-resolution--fan-alerts):**
- **Resolution cadence — DECIDED (compute-time fixed-point):** auto-bid resolves as a pure pre-pass at each preview/binding run — iterate placement, raise displaced auto-bidders ≤cap, re-run until stable. Monotonic + cap-bounded → terminates. Avoids real-time cascade infra; fits the pure-GAE architecture.
- **Raise rule — DECIDED (Julia, 2026-05-28): $5 above the minimum to hold the preferred section.** When displaced from their preferred section, raise to $5 over the minimum price that keeps them in it, bounded by cap. Reconciles Cope (percentage) and Julia (whole number) as a need-based whole-number raise. **⚠️ Diverges from Cope's percentage preference — Cope to confirm before it ships.** Composer copy updated to the section-defense framing.
- **Alert delivery:** in-app (DisplacementToast) ships without external services; email needs Resend verified; SMS needs Twilio (unbuilt). Custom alerts = fan-set thresholds ("tell me if I drop below section X" / "if I'm outbid entirely").
**Status:** Design decided (ADR-0018) and **✅ BUILT (#72–#76):** auto-bid resolver in preview (#72) + honored at binding (#73), displacement-alert persistence (#74), fan-facing alerts on the Show page (#75), and alerts emitted at binding (#76). The `$5-above-minimum` raise rule **shipped as specified but still diverges from Cope's percentage preference — Cope to confirm; if he objects, the increment rule is a localized change.** Remaining: DisplacementToast still needs polling/push; email alerts need Resend verified; SMS needs Twilio.

### NEW-14 — Atomic seating units (tables / boxes): protect or co-seat?
**Source:** Julia, 2026-05-31 (venue-builder UX pass — added per-tier unit types).
**Affects:** GAE (`launchpad.ts` run construction + `placement.ts`), the venue generator, new property tests.
**Context:** The inline venue builder now lets an operator tag a tier's unit type as Rows / Tables / Boxes / GA / Custom. Today that's **labels only** — the GAE fills every unit seat-by-seat like a row, so a group of 4 at an 8-top leaves 4 seats open for strangers and a group of 6 can be split across a table boundary.
**The question:** for a true atomic unit (table/box), at a partially-filled unit do we **protect** the remaining seats (a unit holds one group only — worse fill rate, better experience) or **co-seat** strangers to fill it (better economics, worse experience)? And how do over-capacity groups behave — **bump** to the next unit or **split** across units (note NEW-6 already bars seat-splitting for assigned seats)?
**Status:** Open. Blocks the atomic-seating GAE work tracked in [REMAINING_WORK.md](REMAINING_WORK.md) post-beta item 12 (VenueBuilder). Labels shipped 2026-05-31; behavior waits on this answer (Cope/Julia).

---

## Cope super-fan feedback (2026-06-04) — design needed

Four asks from Cope, framed as "things a super fan would appreciate." None blocks
beta. Two are mostly *surfacing existing data* (venue seating, manifest); two are
*net-new builds* (imagery, merch). Slice plan in
[REMAINING_WORK.md](REMAINING_WORK.md) ("Cope super-fan feedback" section).

### NEW-15 — Show / artist imagery (poster + artist photo)
**Source:** Cope, 2026-06-04 ("add image of show — picture of artist or poster for the show").
**Affects:** `artists` + `shows` schema (new image-URL columns), a new file-upload
path + object storage, ShowCreate / artist-profile UI, and every place a show is
rendered (`/shows` index, fan show detail, the ticket stub, the artist page).
**Today:** zero image support anywhere — no columns, no upload route, no storage client.
**Working assumption (to confirm):**
- **Both levels.** An **artist photo** stored on `artists` (reused across that artist's shows) *and* an optional **per-show poster** on `shows` that overrides it. Render fallback chain: show poster → artist photo → text placeholder.
- **Storage:** Supabase Storage (we're already on Supabase) — a public-read bucket, server-side authenticated writes via the service role key. The provider choice (Supabase Storage vs. Vercel Blob vs. S3) gets a short ADR when the slice is greenlit.
- **Who uploads:** artist self-serve (on ShowCreate + an artist-profile editor) and admin always. No image moderation for MVP (trusted artists).
**Open for Cope/Julia:** is the per-show poster override needed for the first show, or is an artist photo enough to start? Any aspect-ratio / brand constraints?
**Status:** Open. Contained build; the only real decision is storage provider (deferred to a build-time ADR).

### NEW-16 — Fan-facing venue seat map ("load venue seating")
**Source:** Cope, 2026-06-04 ("you should be able to load venue seating … ticket manifest").
**Affects:** the fan show-detail view (extends the existing `VenuePreview`), the ticket stub / `AllocationFinal` ("your seat" highlight).
**Today:** the full venue model is live (`venues`, `venue_architectures` rows/sections/tiers/GA/capacity, partial-venue activation via `shows.activeRowIds`). Fans already see a `VenuePreview` and artists see a provisional-placement seat map — so the *data* is loaded; the question is how much of the room to **show the fan** and where.
**⚠️ Needs Cope clarification — "load venue seating" is ambiguous:** (a) a richer fan-facing interactive seat map on the show page ("see the room before I bid"); (b) "your seat" shown on the ticket / result page so the fan knows where they'll sit; or (c) importing a venue's real seating chart into the system (that's the VenueBuilder / importer work already tracked — Q23/Q24 + REMAINING_WORK item 12). Most likely (a)+(b) given the "super fan" framing.
**Status:** Open pending Cope's clarification on which of (a)/(b)/(c) he means. (a)/(b) are surfacing work; (c) is the existing VenueBuilder track.

### NEW-17 — Ticket manifest (per-fan, who's seated where)
**Source:** Cope, 2026-06-04 ("ticket manifest").
**Affects:** the admin command center (a new Tickets/Manifest section) and the artist ShowAdmin "Fans · data" tab (the deliberate placeholder at `ShowAdminTabs.tsx`).
**Today:** the data is all present — `seat_assignments` + `tickets` (+ `ticketScans`) say exactly who holds which seat and whether they've scanned in. The artist "Fans · data" tab is a placeholder pending a privacy review.
**The split that matters:**
- **Admin/ops manifest is UNBLOCKED.** Q30 already decided "Auckets sees everything," so an admin-facing full manifest (per-fan rows: email/phone/group/offer/seats/ticket+scan status, CSV export) needs no new product decision — just build.
- **Artist manifest needs the privacy scope.** Q30 says the artist sees "totals + averages per section," not per-fan PII. ADR-0017 keeps private-offer fields server-only. So what an *artist* may see per-fan (de-identified rows? names only? full contact?) is the open decision — reconcile with Cope before building the artist-facing version.
**Status:** Admin manifest open-but-unblocked (build any time). Artist manifest blocked on the per-fan-visibility decision (Cope/Julia; ties to Q30 + ADR-0017).

### NEW-18 — Merch / limited-edition drops
**Source:** Cope, 2026-06-04 ("a merch purchase should be an option … limited edition merch drops or merch for shows").
**Affects:** a net-new commerce subsystem — schema (products/variants/inventory/orders), a storefront UI, payments (a straight charge, *not* the auth-hold offer model), and artist payout via Stripe Connect.
**Today:** nothing — zero product/store/inventory/SKU anywhere.
**Captured as [ADR-0019](DECISIONS.md#adr-0019--merch--limited-edition-drops-storefront-approach) (Proposed).** The ADR lays out the two directions (native-on-our-Stripe vs. Shopify integration) with tradeoffs and the full list of product questions for Cope (drop mechanics, inventory/variants, fulfillment ship-vs-pickup, super-fan gating, payout/fees, refunds, sales tax). **Direction not yet chosen** — Julia asked to decide it in the ADR.
**Status:** Open. No code until the ADR direction + Cope's product answers land.

---

## New product concepts from v2 — confirmed, design needed

These came in via Cope's and Julia's v2 notes. They're real features, not "maybe-someday." Each gets its own ADR as the design firms up. None of them blocks the GAE spike (Week 2).

| Concept | Source | ADR | Notes |
|---|---|---|---|
| **Auto-bid** — fan sets a cap; system raises automatically when outbid | Q12 note | [ADR-0017](DECISIONS.md#adr-0017--auto-bid--private-offers) | Implementation in Week 4 alongside offer submission |
| **Private offers (hidden price)** — exceeding the hidden threshold auto-wins | Q12 note | [ADR-0017](DECISIONS.md#adr-0017--auto-bid--private-offers) | Adds a `private_threshold_cents` field on offers |
| **Resale on the site (capped at original)** — sellers get back what they paid, artist captures any uplift | Q10 note | [ADR-0014](DECISIONS.md#adr-0014--resale-capped-at-original-price) | Phase 1.5+, but schema lands in Week 3 |
| **Real-time projected allocation** — fan sees their projected seat updated live as the pool changes | Q10 note | TBD when wired (Week 4–5) | SSE-first per `TECHNICAL_INTEGRATION.md` § 9 |
| **Rotating geo-gated QR ticket** — code rotates every minute, only valid when fan is near venue | Q34 note | [ADR-0015](DECISIONS.md#adr-0015--rotating-geo-gated-qr-ticket) | Needs `tickets` table; landed when ticket viewer ships |
| **Upgrade-buyout** — fan submits upgrade request → Auckets emails current seat-holder with buyout offer | Q29 note | TBD | Operational workflow, not a fan-side feature for MVP |
| **Miracle tickets** — fans can gift their tickets to people who fell off the allocation | callout after Q31 | TBD | Phase 1.5+ |
| **SMS at MVP (not Phase 1.5)** | Q36 note | [ADR-0016](DECISIONS.md#adr-0016--sms-at-mvp-via-twilio) | Adds Twilio to the foundation; 10DLC registration is the long pole |
| **Auckets-controlled pause / end-early** — artist submits a request; Auckets executes | Q28 note | [ADR-0013](DECISIONS.md#adr-0013--aucketscontrolled-pause-and-endearly) | Changes Week 6 dashboard scope |
| **Roles = `FAN` + `ARTIST` + `AUCKETS_ADMIN`** (4th role `VENUE_STAFF` added by Week 7) | Q31 note | [ADR-0012](DECISIONS.md#adr-0012--rbac-roles-mvp) | Simpler than the 4-role plan in the design doc |
| **Group size cap = 10** (was 8 in v1) | Q15 note | [ADR-0011](DECISIONS.md#adr-0011--group-size-cap--10) | Artist can override per show |

---

## Phase 2 — deferred

### Q35 — Linking past concert history (Spotify, Songkick, etc.)
Defer.

### Q39 — Bond auto-accept threshold
Defer until we have show data to calibrate.

### Q40 — Bond upgrade approval (automatic vs artist veto)
Defer. Likely automatic with artist veto.

### Q41 — Bond rewards
Defer. Fulfillment ops is its own problem.

### Q42 — Bond decay
Defer. Likely annual decay.

### Q43 — Bond visibility to fans (raw score vs tier names)
Defer. Likely tier names not raw scores.

### Q44 — Customizable per-fan outbid triggers
**Source:** Q12 note ("Would be cool if they could customize these triggers").
Defer. Auto-bid (ADR-0017) is the bigger lever; customization can come later.

### NEW-19 — Background-jobs vendor: Inngest is provisional
**Source:** Josh, 2026-06-11, while wiring production env (the #116 deploy guard).
Inngest Cloud is the production background-jobs service (binding sweep, card-failure expiry, ticket issuance, imminent emails — see `src/app/api/inngest/route.ts`). Adopted on the free Hobby tier (50k executions/mo; our baseline is ~20k) because it was already wired in and the closest competitor (Trigger.dev) is near-identical. **Josh explicitly flagged we may want to change vendors later.** Revisit triggers: pricing (Pro is $75/mo past 50k executions or 5 concurrent), reliability incidents, or beta-scale concurrency. The switching seam is intentionally thin — job logic lives in our own functions under `src/lib/jobs/functions/`, with Inngest as a wrapper; a port to Trigger.dev or Vercel Cron + queue is roughly one PR.

---

## Resolved in v2 — answered by Cope or Julia, 2026-05-25

Listed for the audit trail. Where a decision drives code, it links to its ADR.

| Q | Decision | ADR / source |
|---|---|---|
| Q2 | Heroku is out; Vercel + Supabase. Clerk + Stripe + Google Workspace roll forward | Julia 5/21 |
| Q3 | Stripe account exists; will flip from HFC's admin to AUCKETS before production cutover. Confirm Stripe Connect setup | Julia 5/21 + [SECURITY.md #37](SECURITY.md) |
| Q4 | Auth = Clerk | Julia 5/21 |
| Q5 | Clean-slate database (no migration) | Julia 5/21 |
| Q7 | Beta show at Cope's place or untraditional venue, ~50-cap | Cope |
| Q8 | Alice 5/26 is off. Target internal date: ~8 weeks from build start | Inferred from no-date answer |
| Q9 | First venue ≤175-cap; second is the 1,200-cap Austin theater using only some sections | Cope |
| Q10 | Part-seated, part-GA. **Waterfalling between tiers is mandatory.** Resale on site at original price | Cope |
| Q12 | Yes, fans can revise upward. Email on outbid. Auto-bid + private offers are features | Cope → [ADR-0017](DECISIONS.md#adr-0017--auto-bid--private-offers) |
| Q13 | Immediate release on outbid (both seat and Stripe hold) | Cope |
| Q14 | Sold-out → immediate rejection. No waitlist for MVP | Cope |
| Q15 | Group cap = 10, admin-configurable | Cope → [ADR-0011](DECISIONS.md#adr-0011--group-size-cap--10) |
| Q16 | One offer per fan per show | Cope |
| Q17 | Offer window default 14 days, artist sets per show | Cope |
| Q18 | Artist sets floor price | Julia |
| Q22 | No fan-side service fee (honor "no hidden fees") | Working assumption, no objection |
| Q25 | Artist sets holds in dashboard, tagged by source. Venue holds read-only | Cope |
| Q27 | Leave orphan seats unsold for MVP (Option A) | Cope |
| Q28 | Auckets controls pause / end-early; artist submits requests | Cope → [ADR-0013](DECISIONS.md#adr-0013--aucketscontrolled-pause-and-endearly) |
| Q29 | Manual override post-allocation: fan submits upgrade request → Auckets emails seat-holder with buyout | Cope |
| Q30 | Artist sees totals + averages per section. Auckets sees everything | Cope |
| Q31 | Roles = `ARTIST` + `AUCKETS_ADMIN`. Plus `FAN` (implicit) and `VENUE_STAFF` (added by Week 7) | Cope → [ADR-0012](DECISIONS.md#adr-0012--rbac-roles-mvp) |
| Q32 | Fan account required (no guest offers) | Julia |
| Q33 | Email required; Google + Apple social login; phone optional after first offer | Working assumption, no objection |
| Q34 | Rotating geo-gated QR ticket, validated through Auckets site only when fan is near venue | Cope → [ADR-0015](DECISIONS.md#adr-0015--rotating-geo-gated-qr-ticket) |
| Q36 | SMS + email at MVP (not Phase 1.5) | Cope → [ADR-0016](DECISIONS.md#adr-0016--sms-at-mvp-via-twilio) |
| Q37 | AUCKETS-branded sender for MVP, artist name prominent | Cope |
| Q38 | Status-change emails + a single "allocation imminent" pre-run notice | Working assumption, no objection |
| NEW-2 | Hybrid: continuous preview + binding checkpoints | Cope (already [ADR-0004](DECISIONS.md#adr-0004--hybrid-allocation-continuous-preview--binding-checkpoints), now confirmed) |
| NEW-3 | Waterfalling tiers are a first-class GAE feature | Cope (already in [GAE_SPEC.md §5](GAE_SPEC.md) and `launchpad.ts` Waterfall slice) |
| NEW-4 | Partial-venue activation is first-class (`activeRowIds` per show) | Cope (already in `VenueArchitecture` type) |
| NEW-5 | Idempotency keys on offer submission, propagated to Stripe | [ADR-0010](DECISIONS.md#adr-0010--idempotency-keys-on-offer-submission) |
| NEW-6 | **Group splits never acceptable for MVP.** No `accept_split` even as a schema field | Cope |
| NEW-7 | High observability. Sentry + structured logs from day one; show-day runbook before Austin | Cope |

---

## How to use this file

When you're about to make a decision that touches one of these questions:

1. Check whether the "working assumption" is good enough to proceed.
2. If yes, proceed — but leave a code comment referencing the question (`// see OPEN_QUESTIONS.md Q14`).
3. If no, stop and surface the question. Don't guess on product decisions.

When a question gets answered:

1. Move the resolution into [`DECISIONS.md`](DECISIONS.md) as an ADR if it's architecturally significant.
2. Update the relevant doc ([`CONVENTIONS.md`](CONVENTIONS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`GAE_SPEC.md`](GAE_SPEC.md), [`ROADMAP.md`](ROADMAP.md)) if it affects how we build.
3. Move the entry into "Resolved" at the bottom of this file with a date and pointer to the ADR — don't delete the history.
