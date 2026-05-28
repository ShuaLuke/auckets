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
| Open high-priority  | 4     |
| Phase 2 (deferred)  | 7     |
| Resolved in v2      | 24    |

Last full revision: **2026-05-25**, based on Julia + Cope answers in
`AUCKETS_Open_Questions_v2.docx`.

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
