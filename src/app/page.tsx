// Home page (`/`). Auth- and role-aware:
//
//   - Logged out  → the marketing landing (prototype-fidelity port of
//     design/ui_kits/auckets/screens/Landing.jsx): hero, "How it works",
//     comparison band, "For artists", FAQ, footer. The hero ticket card
//     is driven by the real soonest open show (evergreen fallback when
//     none is open).
//   - Logged in   → a personalized home: welcome + role-aware quick links
//     (Dashboard / My bids for everyone; per-artist management for artist
//     members; Admin + Requests for AUCKETS_ADMIN) + the fan's next open
//     show, with a light "How it works" refresher kept below.
//
// Why server-branch on auth() rather than Clerk's <SignedIn>/<SignedOut>:
// the two states render materially different trees and read different
// data, so a server branch is cleaner than a client toggle. Clerk's modal
// sign-in already redirects to /dashboard (signInFallbackRedirectUrl), so
// "/" never needs to react to a client-side sign-in in place.
//
// Data exposure note: the logged-out hero surfaces poster-level show
// metadata (artist / venue / city / date / status) to anonymous visitors.
// That's intentional and safe — it reads server-side via Drizzle (no anon
// key / PostgREST), reuses listOpenShows (already status="open", so drafts
// and unannounced shows are excluded) + presentShowSummary (which carries
// no offer counts, fill %, or rank — i.e. no demand signals). If a show
// can ever be status="open" before it's meant to be public, add an
// explicit visibility flag rather than overloading "open".
//
// Marketing copy below is preserved verbatim from the prototype. A
// dedicated copy review is a separate workstream (see
// docs/LANDING_PAGE_PLAN.md) — several FAQ claims describe behavior gated
// on the still-unconfirmed ADR-0003.

import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import Link from "next/link";

import { ShowRow } from "@/components/dashboard/ShowRow";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MarqueeButton } from "@/components/ui/MarqueeButton";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  listArtistsManageableByUser,
  listOpenShows,
  userIsAdmin,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowSummary,
  type ShowSummaryView,
} from "@/lib/presenters";

// Reads auth + the open-shows list on every request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { userId } = await auth();

  if (userId) {
    // Logged-in: personalized, role-aware home.
    const [openShows, isAdmin, manageableArtists, user] = await Promise.all([
      listOpenShows(db),
      userIsAdmin(db, userId),
      listArtistsManageableByUser(db, userId),
      currentUser(),
    ]);

    // listOpenShows is ordered by doorsAt asc, so [0] is the soonest.
    const now = new Date();
    const soonest = openShows[0] ?? null;
    let nextShow: ShowSummaryView | null = null;
    if (soonest) {
      const offer = await getOfferByShowAndUser(db, soonest.id, userId);
      nextShow = presentShowSummary(soonest, now, DEFAULT_TZ, offer);
    }

    const greeting =
      user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? null;

    return (
      <SignedInHome
        greeting={greeting}
        nextShow={nextShow}
        isAdmin={isAdmin}
        manageableArtists={manageableArtists}
      />
    );
  }

  // Logged-out: marketing landing with the real soonest-show hero.
  const openShows = await listOpenShows(db);
  const heroShow = openShows[0]
    ? presentShowSummary(openShows[0], new Date(), DEFAULT_TZ)
    : null;

  return (
    <main style={{ background: "var(--paper)" }}>
      <Hero heroShow={heroShow} />
      <HowItWorks />
      <ComparisonBand />
      <ForArtists />
      <Faq />
      <Footer />
    </main>
  );
}

// =========================================================================
// Signed-in personalized home
// =========================================================================

function SignedInHome({
  greeting,
  nextShow,
  isAdmin,
  manageableArtists,
}: {
  greeting: string | null;
  nextShow: ShowSummaryView | null;
  isAdmin: boolean;
  manageableArtists: ReadonlyArray<{ id: string; name: string }>;
}) {
  const linkProps = {
    className: "no-underline",
    style: { borderBottom: "none" } as const,
  };

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-8 py-12">
        {/* Welcome band */}
        <div className="mb-7">
          <Eyebrow className="mb-2">Welcome back</Eyebrow>
          <h1 className="text-4xl">
            {greeting ? `Hi, ${greeting}` : "Your shows"}
          </h1>
        </div>

        {/* Role-aware quick links */}
        <div className="mb-9 flex flex-wrap items-center gap-3">
          <Link href="/dashboard" {...linkProps}>
            <Button>Go to dashboard</Button>
          </Link>
          <Link href="/my-bids" {...linkProps}>
            <Button variant="secondary">View bid history</Button>
          </Link>
          {manageableArtists.map((artist) => (
            <Link key={artist.id} href={`/artists/${artist.id}`} {...linkProps}>
              <Button variant="secondary">Manage {artist.name}</Button>
            </Link>
          ))}
          {isAdmin && (
            <>
              <Link href="/admin" {...linkProps}>
                <Button variant="secondary">Admin</Button>
              </Link>
              <Link href="/admin/requests" {...linkProps}>
                <Button variant="secondary">Requests</Button>
              </Link>
            </>
          )}
        </div>

        {/* Next show */}
        <Eyebrow className="mb-3">
          {nextShow ? "Your next show" : "Upcoming"}
        </Eyebrow>
        {nextShow ? (
          <ShowRow show={nextShow} />
        ) : (
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            No open shows right now. Check back closer to the next announced
            date.
          </div>
        )}
      </div>

      {/* A light marketing refresher — how allocation works — kept for
          returning users without the first-timer FAQ / comparison band. */}
      <HowItWorks />
      <Footer />
    </main>
  );
}

// =========================================================================
// Hero — design Landing.jsx lines 9-39
// =========================================================================

function Hero({ heroShow }: { heroShow: ShowSummaryView | null }) {
  return (
    <section className="mx-auto px-8" style={{ maxWidth: 1080, padding: "88px 32px 56px" }}>
      <div className="flex items-end gap-16">
        <div style={{ flex: 1.4 }}>
          <Eyebrow className="mb-5">A fairer way to seat a room</Eyebrow>
          <h1
            className="display-1 mb-6"
            style={{ maxWidth: 720 }}
          >
            Front row, fair price.
            <br />
            <span style={{ color: "var(--fg-muted)" }}>
              No auctions, no countdowns.
            </span>
          </h1>
          <p
            className="font-sans mb-8"
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              letterSpacing: "-0.015em",
              color: "var(--ink-600)",
              maxWidth: 540,
            }}
          >
            Submit one offer — your group size, your price per ticket. The
            Greenwood Allocation Engine ranks every offer in the room and
            places groups intelligently, keeping you together.
          </p>
          <div className="flex items-center gap-3">
            <SignUpButton mode="modal">
              <MarqueeButton iconAfter={<ArrowRight size={18} strokeWidth={1.75} aria-hidden />}>
                Create an account
              </MarqueeButton>
            </SignUpButton>
            {/* Shows are sign-in gated — there's no public show page — so
                this prompts sign-in rather than dead-ending at /dashboard,
                which would just bounce an anonymous visitor to /sign-in. */}
            <SignInButton mode="modal">
              <Button variant="ghost">See an upcoming show →</Button>
            </SignInButton>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <HeroTicketCard show={heroShow} />
        </div>
      </div>
    </section>
  );
}

// HeroTicketCard — design Landing.jsx lines 210-241. Driven by the real
// soonest open show; falls back to an evergreen illustrative example when
// no show is open so it never renders a stale/past date. Poster-level
// fields only — no fabricated price or seat assignment.
function HeroTicketCard({ show }: { show: ShowSummaryView | null }) {
  const artist = show?.artist ?? "Your favorite artist";
  const venue = show?.venue ?? "The Venue";
  const subline = show
    ? [show.city, show.dateLong].filter(Boolean).join(" · ")
    : "A stage near you";
  const statusLabel = show?.statusLabel ?? "Offers open";
  // Map status → badge tone; default to the "open" look for the fallback.
  const tone: BadgeTone =
    show && show.status !== "open" ? "upcoming" : "open";

  return (
    <div
      className="relative rounded-xl border"
      style={{
        background: "var(--page)",
        borderColor: "var(--ink-900)",
        padding: 24,
        boxShadow: "6px 6px 0 0 var(--ink-900)",
      }}
    >
      {/* Perforation circles — the visual ticket-stub indent on both edges. */}
      <div
        className="absolute rounded-full border"
        style={{
          left: -8,
          top: "54%",
          width: 16,
          height: 16,
          background: "var(--paper)",
          borderColor: "var(--ink-900)",
        }}
      />
      <div
        className="absolute rounded-full border"
        style={{
          right: -8,
          top: "54%",
          width: 16,
          height: 16,
          background: "var(--paper)",
          borderColor: "var(--ink-900)",
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow className="mb-1.5">{artist}</Eyebrow>
          <div
            className="font-display font-bold"
            style={{ fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.025em" }}
          >
            {venue}
          </div>
          <div
            className="font-sans"
            style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}
          >
            {subline}
          </div>
        </div>
        <Badge tone={tone}>{statusLabel}</Badge>
      </div>
      <div
        style={{
          borderTop: "1px dashed var(--ink-900)",
          margin: "20px 0",
        }}
      />
      <div
        className="font-sans"
        style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink-700)" }}
      >
        Submit one offer — your price, your group size. The Greenwood
        Allocation Engine seats you.
      </div>
      <div
        className="mt-3.5 rounded font-mono"
        style={{
          padding: "8px 12px",
          background: "var(--greenwood-50)",
          fontSize: 11,
          color: "var(--greenwood-700)",
        }}
      >
        No countdowns · one ranked allocation
      </div>
    </div>
  );
}

// =========================================================================
// How it works — design Landing.jsx lines 41-68
// =========================================================================

const HOW_IT_WORKS_STEPS = [
  {
    n: "01",
    t: "Submit an offer",
    d: "Pick your group size and what you're willing to pay per ticket. One offer per fan per show. Editable up to 24 hours before allocation.",
  },
  {
    n: "02",
    t: "See where you'd land",
    d: "A non-binding preview shows your seats based on every other offer currently in the room. It updates as offers come in.",
  },
  {
    n: "03",
    t: "Allocation runs once",
    d: "At an announced checkpoint, the GAE walks the venue from best row to worst, places ranked groups together, and we charge your card.",
  },
] as const;

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      style={{
        background: "var(--page)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="mx-auto" style={{ maxWidth: 1080, padding: "64px 32px" }}>
        <Eyebrow className="mb-3">How it works</Eyebrow>
        <h2 className="mb-10" style={{ maxWidth: 600 }}>
          One offer. One ranked allocation. One announced checkpoint.
        </h2>
        <div className="grid grid-cols-3 gap-6">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.n} className="flex flex-col gap-2.5">
              <span
                className="font-mono"
                style={{
                  fontSize: 12,
                  color: "var(--brand)",
                  letterSpacing: "0.08em",
                }}
              >
                {step.n}
              </span>
              <h3>{step.t}</h3>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--ink-500)",
                }}
              >
                {step.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// Comparison band — design Landing.jsx lines 70-108
// =========================================================================

const NOT_THIS = [
  "Countdown timers and per-ticket bidding wars",
  "Different prices in the same zone",
  "Strangers between you and your friends",
  "First-come-first-served beats fairness",
];

const THIS_INSTEAD = [
  "One offer per fan per show",
  "Best-ranked groups get the best seats",
  "Groups stay together; orphan seats avoided",
  "Rank is by offer, not by submission time",
];

function ComparisonBand() {
  return (
    <section className="mx-auto" style={{ maxWidth: 1080, padding: "72px 32px" }}>
      <div className="grid grid-cols-2 gap-6">
        <Card style={{ padding: 28 }}>
          <Eyebrow className="mb-2.5">Not this</Eyebrow>
          <h3 className="mb-3.5">An auction.</h3>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {NOT_THIS.map((t) => (
              <li
                key={t}
                className="flex gap-2.5"
                style={{ color: "var(--ink-500)", fontSize: 14, lineHeight: 1.5 }}
              >
                <X
                  size={16}
                  strokeWidth={2}
                  style={{ color: "var(--brick-500)", marginTop: 2, flexShrink: 0 }}
                  aria-hidden
                />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <div
          className="rounded-xl border p-7"
          style={{
            background: "var(--page)",
            borderColor: "var(--ink-900)",
            boxShadow: "4px 4px 0 0 var(--ink-900)",
          }}
        >
          <Eyebrow className="mb-2.5">This instead</Eyebrow>
          <h3 className="mb-3.5">A single ranked allocation.</h3>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {THIS_INSTEAD.map((t) => (
              <li
                key={t}
                className="flex gap-2.5"
                style={{ color: "var(--ink-700)", fontSize: 14, lineHeight: 1.5 }}
              >
                <Check
                  size={16}
                  strokeWidth={2}
                  style={{ color: "var(--brand)", marginTop: 2, flexShrink: 0 }}
                  aria-hidden
                />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// For artists — design Landing.jsx lines 110-149
// =========================================================================

function ForArtists() {
  return (
    <section style={{ background: "var(--ink-900)", color: "var(--paper)" }}>
      <div className="mx-auto" style={{ maxWidth: 1080, padding: "72px 32px" }}>
        <div className="grid items-center gap-14" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
          <div>
            <Eyebrow className="mb-4" style={{ color: "var(--marquee-500)" }}>
              For artists
            </Eyebrow>
            <h2
              className="mb-5"
              style={{ fontSize: 44, color: "var(--paper)" }}
            >
              Run a fair room. Earn what the room is worth.
            </h2>
            <p
              className="mb-4"
              style={{
                fontSize: 16,
                lineHeight: 1.55,
                color: "var(--ink-200)",
                maxWidth: 520,
              }}
            >
              You set the floor per section. Fans submit offers. The Greenwood
              Allocation Engine fills your venue holistically — no zone
              bidding wars, no orphan seats, no opaque dynamic pricing.
            </p>
            <p
              className="mb-7"
              style={{
                fontSize: 16,
                lineHeight: 1.55,
                color: "var(--ink-200)",
                maxWidth: 520,
              }}
            >
              Every allocation is logged in full. Every override is logged
              with a reason. Your fans see exactly the same thing you do.
            </p>
            <SignUpButton mode="modal">
              <MarqueeButton
                iconAfter={<ArrowRight size={18} strokeWidth={1.75} aria-hidden />}
                style={{
                  background: "var(--paper)",
                  color: "var(--ink-900)",
                  boxShadow: "4px 4px 0 0 var(--marquee-500)",
                }}
              >
                Pitch your venue
              </MarqueeButton>
            </SignUpButton>
          </div>
          {/* allocation_log JSON preview — reinforces the "every decision
              logged" point textually. Colors map to the design's hex
              palette using the marquee + greenwood tokens. */}
          <div
            className="rounded-xl border font-mono"
            style={{
              background: "var(--ink-700)",
              borderColor: "var(--ink-600)",
              padding: 22,
              fontSize: 12,
              color: "var(--ink-300)",
              lineHeight: 1.8,
            }}
          >
            <div style={{ color: "var(--greenwood-300)" }}>{"// allocation_log.json"}</div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"action"'}</span>
              {": "}
              <span style={{ color: "var(--paper)" }}>{'"PLACED"'}</span>,
            </div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"offer_id"'}</span>
              {": "}
              <span style={{ color: "var(--paper)" }}>{'"offer_8f3a"'}</span>,
            </div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"venue_row_id"'}</span>
              {": "}
              <span style={{ color: "var(--paper)" }}>{'"row_aa_orch"'}</span>,
            </div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"seats"'}</span>
              {": ["}
              <span style={{ color: "var(--paper)" }}>{'"7","9","11","13"'}</span>
              {"],"}
            </div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"rank_key"'}</span>
              {": "}
              <span style={{ color: "var(--paper)" }}>42004</span>,
            </div>
            <div>
              <span style={{ color: "var(--marquee-300)" }}>{'"reason"'}</span>
              {": "}
              <span style={{ color: "var(--paper)" }}>{'"top of waterfall"'}</span>
            </div>
            <div className="mt-3.5" style={{ color: "var(--ink-400)" }}>
              Every decision. Every show. Append-only.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// FAQ — design Landing.jsx lines 151-192
// Copy preserved verbatim from the design.
// =========================================================================

const FAQ_ITEMS: ReadonlyArray<[string, string]> = [
  [
    "How is rank calculated?",
    "rank_key = (price_per_ticket_cents × 1000) + group_size. Price wins; group size only breaks ties at equal price. Earliest submission breaks remaining ties.",
  ],
  [
    "Can I revise my offer?",
    "Yes — upward only, up to 24 hours before binding allocation. Lowering is never allowed. Each revision releases your card auth and creates a new one.",
  ],
  [
    "What happens if I'm outbid?",
    "There's no \"outbid\" — there's rank. If a lot of higher-ranked offers come in, your provisional placement moves to a lower row, or to \"unplaced\". You'll see this in real time.",
  ],
  [
    "When am I charged?",
    "When binding allocation runs (24h before doors). Before that, your card is authorized but not charged. If you're not placed, the auth is released and you pay $0.",
  ],
  [
    "What if the show sells out before my offer is competitive?",
    "You'll see \"unplaced\" on the preview and get a notification 24h before binding. You can revise upward; you can't go below the tier floor.",
  ],
  [
    "Are there service fees?",
    "No. The price you offer is the price you pay. Stripe fees come from the artist payout.",
  ],
];

function Faq() {
  return (
    <section style={{ background: "var(--paper)" }}>
      <div className="mx-auto" style={{ maxWidth: 760, padding: "72px 32px" }}>
        <Eyebrow className="mb-4">Common questions</Eyebrow>
        <h2 className="mb-7" style={{ fontSize: 36 }}>
          Things people ask before their first offer.
        </h2>
        <div className="flex flex-col gap-0">
          {FAQ_ITEMS.map(([q, a]) => (
            <details
              key={q}
              className="group"
              style={{
                borderBottom: "1px solid var(--border)",
                padding: "18px 0",
              }}
            >
              <summary
                className="flex cursor-pointer items-center justify-between gap-3 font-sans"
                style={{
                  listStyle: "none",
                  fontSize: 17,
                  fontWeight: 500,
                  color: "var(--ink-900)",
                  letterSpacing: "-0.01em",
                }}
              >
                <span>{q}</span>
                <Plus
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: "var(--ink-400)", flexShrink: 0 }}
                  className="transition-transform group-open:rotate-45"
                  aria-hidden
                />
              </summary>
              <p
                className="mt-3"
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--ink-500)",
                  maxWidth: 620,
                }}
              >
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// =========================================================================
// Footer — design Landing.jsx lines 194-205
// =========================================================================

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      style={{
        background: "var(--ink-900)",
        color: "var(--ink-300)",
        borderTop: "1px solid var(--ink-700)",
      }}
    >
      <div
        className="mx-auto flex flex-wrap items-center justify-between gap-4"
        style={{ maxWidth: 1080, padding: "40px 32px" }}
      >
        <span
          className="wordmark"
          style={{ fontSize: 16, color: "var(--paper)" }}
        >
          AUCKETS
        </span>
        <span className="font-sans" style={{ fontSize: 12 }}>
          Not an auction. © {year} · auckets.com
        </span>
      </div>
    </footer>
  );
}
