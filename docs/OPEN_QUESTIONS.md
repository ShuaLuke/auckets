# Open Questions

What is not yet decided. Things to flag rather than assume. When a question is answered, move it to `DECISIONS.md` as an ADR or update the relevant doc and mark the entry here as resolved.

The detailed reasoning and tradeoffs for each question live in the larger consolidated document (`AUCKETS_Open_Questions_v2.docx`); this file is the working list for the repo.

---

## Blockers — must answer before building the affected feature

### Q12 — Can a fan revise their offer upward after submitting?
**Affects:** Offer schema, submission API, audit trail.
**Working assumption:** Yes, up to 24 hours before binding allocation. Lowering never allowed. Each revision releases the old Stripe payment method and creates a new one.
**Don't assume until confirmed.**

### Q13 — Outbid window
**Affects:** Allocation flow, Stripe charge timing.
**Working assumption:** Immediate release on outbid. No response window. Fan can resubmit.
**Don't assume until confirmed.**

### Q14 — Sold-out behavior
**Affects:** Allocation flow, post-allocation UX.
**Working assumption:** Immediate rejection with notification for MVP. Add waitlist in Phase 1.5 if demand surfaces.
**Don't assume until confirmed.**

### Q19 — Per-section floor pricing
**Affects:** Pricing schema, artist dashboard.
**Working assumption:** Yes — different floors per section. Schema already supports this.
**Strongly implied by Cope's answer to Q10; need explicit confirmation.**

### Q20 — Platform fee model
**Affects:** Stripe Connect configuration, artist payout calculation.
**Working assumption:** Configurable application fee percentage, defaulting to 0% for the first show.
**Don't ship to production without confirmation.**

### Q23 — Who builds venue architecture
**Affects:** Operational process, tooling priorities.
**Working assumption:** AUCKETS team builds the first 3 venues manually. Importer tool is Phase 1.5.
**No engineering blocker, but operational question for the call.**

### Q24 — Venue manifest format
**Affects:** Importer design (Phase 1.5).
**Working assumption:** Internal canonical format is JSON matching the `VenueRow` schema. Translate from whatever venues provide manually for MVP.
**No MVP blocker, but figures into Q23.**

### NEW-1 — Stripe hold strategy
**Affects:** Payment flow architecture.
**Working assumption (locked in as ADR-0003):** SetupIntent for tokenization + PaymentIntent on acceptance. Effectively decided, but flag if Cope wants a real pre-auth experience for any reason.

### NEW-2 — Rolling vs batch allocation
**Affects:** Allocation flow, UX, fan messaging.
**Working assumption (locked in as ADR-0004 pending confirmation):** Hybrid — continuous non-binding preview, binding allocation at announced checkpoints (24h before door + at door time).
**Cope should confirm explicitly. The HFC build's failure to handle this well is the whole reason this question is here.**

### NEW-3 — Waterfalling tiers as first-class GAE feature
**Affects:** GAE algorithm, offer schema, fan-facing offer form.
**Working assumption:** Yes — fans express tier preference; offers waterfall to compatible tiers when their preferred tier fills.
**The single most important confirmation needed from Cope. The HFC build's "tiers are not waterfalling" problem is exactly what this addresses.**

---

## High priority — needed before that feature is built

### Q15 — Maximum group size
**Working assumption:** Cap of 8. Artist can override per show. Groups larger than 8 are routed to "contact for booking."

### Q16 — Multiple offers per fan per show
**Working assumption:** One offer per fan per show for MVP. Offer is editable (per Q12) but not duplicable.

### Q17 — Offer window length
**Working assumption:** Artist sets per show, platform default 14 days.

### Q21 — Stripe pre-auth duration
**Status:** Researched. Effectively answered by ADR-0003 (we don't use pre-auths).

### Q22 — Fan-side service fee
**Working assumption:** None. Honor the "no hidden fees" promise. Stripe fees come from the artist payout.

### Q25 — Holds management
**Working assumption:** Artist sets holds in dashboard, tagged by source (artist comp, production, ADA, venue-imposed). Venue-imposed holds imported with the manifest as read-only.

### Q26 — Manifest lead time
**Working assumption:** Cope's place built with Cope directly. Austin venue manifest requested via Cope or venue contact in week 2.

### Q27 — Orphan seat policy
**Working assumption:** Leave the orphan for MVP. Track frequency; revisit if it exceeds 2% across shows.

### Q28 — Pause/stop offer window early
**Working assumption:** Yes — artist can pause and resume. Ending early triggers binding allocation.

### Q29 — Manual override of allocation
**Working assumption:** Yes, post-allocation only. All overrides logged with required reason.

### Q30 — Artist visibility into individual offers
**Working assumption:** Aggregate only during the window. Full visibility after allocation runs.
**Cope should confirm — there's a reasonable argument for full visibility throughout.**

### Q31 — Dashboard access roles
**Working assumption:** ARTIST, MANAGER, STAFF, VENUE roles from day one. Configurable per show.

### Q33 — Fan identity minimums
**Working assumption:** Email required (Clerk). Google + Apple social login enabled. Phone optional after first offer.

### Q34 — Attendance verification
**Working assumption:** Manual mark-attended for the first beta show (~50 attendees). QR scanner for Austin and beyond.

### Q36 — Notification channels
**Working assumption:** Email at MVP launch. Begin 10DLC registration in week 4 so SMS is ready for show 2 or 3.

### Q37 — Email branding
**Working assumption:** AUCKETS-branded for MVP, with artist name prominent in body. Per-artist sender domains in Phase 2.

### Q38 — Notification timing
**Working assumption:** Status-change emails only, plus a single "allocation imminent" email before each binding run.

### NEW-4 — Partial-venue activation
**Working assumption:** Yes, first-class feature. Show has `activeRowIds` (subset of venue rows) and `activeSectionIds`.

### NEW-5 — Idempotency
**Status:** Decided as ADR-0010. Idempotency keys on offer submission, propagated to Stripe.

### NEW-6 — Group-splitting escape valve
**Working assumption:** MVP: no splits. Schema includes `acceptSplit` boolean for Phase 1.5. Algorithm not implemented until 1.5.

### NEW-7 — Observability and incident response
**Working assumption:** Sentry + structured logs from day one. Full incident response setup (on-call, runbook, rollback) before Austin show.

---

## Phase 2 — deferred

### Q35 — Linking past concert history
Defer.

### Q39 — Bond auto-accept threshold
Defer until we have show data to calibrate.

### Q40 — Bond upgrade approval
Defer. Likely automatic with artist veto.

### Q41 — Bond rewards
Defer. Fulfillment ops is its own problem.

### Q42 — Bond decay
Defer. Likely annual decay.

### Q43 — Bond visibility to fans
Defer. Likely tier names not raw scores.

---

## How to use this file

When you're about to make a decision that touches one of these questions:

1. Check whether the "working assumption" is good enough to proceed.
2. If yes, proceed — but leave a code comment referencing the question (`// see OPEN_QUESTIONS.md Q14`).
3. If no, stop and surface the question. Don't guess on product decisions.

When a question gets answered:

1. Move the resolution into `DECISIONS.md` as an ADR if it's architecturally significant.
2. Update the relevant doc (`CONVENTIONS.md`, `ARCHITECTURE.md`, `GAE_SPEC.md`, `ROADMAP.md`) if it affects how we build.
3. Mark the entry here as RESOLVED with a date and pointer to the ADR.
4. Don't delete — strikethrough or move to a "Resolved" section at the bottom, so the history is preserved.
