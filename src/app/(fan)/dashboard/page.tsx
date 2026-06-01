// Fan-side Dashboard (Change 02 redesign). Instead of one flat list of
// show rows, the page now:
//   1. leads with the single most important state in a NowHero band,
//   2. groups the rest into "Your offers" / "On the horizon" sections,
//   3. shows calm guaranteed-floor standing on each active offer.
//
// Data: unions the open shows (the horizon) with the fan's offer-shows
// across every status — so a post-binding 'allocated' show with a ready
// ticket can lead the page. Still fully SSR; the only client-free motion is
// the CSS entrance stagger (.auk-reveal).
//
// FUTURE CLEANUP: the loading logic still duplicates GET /api/shows-ish
// reads; extract to src/lib/dashboard/load.ts when a second consumer needs
// it (unchanged from the pre-redesign note).

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { NowHero } from "@/components/dashboard/NowHero";
import { SectionLabel } from "@/components/dashboard/SectionLabel";
import { ShowRow } from "@/components/dashboard/ShowRow";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getVenueArchitecturesByIds,
  listOffersForUser,
  listOpenShows,
  listSeatAssignmentsByOfferIds,
  listShowSummariesByIds,
  listTicketsByAssignmentIds,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentNowHero,
  presentShowSummary,
  type NowHeroView,
  type ShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

type DashboardData = {
  shows: ShowSummaryView[];
  hero: NowHeroView | null;
};

// Hero priority: a ready ticket (0) leads over a binding-imminent offer (1);
// within a priority, the soonest show wins.
function heroPriority(hero: NowHeroView): number {
  return hero.kind === "ticket-ready" ? 0 : 1;
}

async function loadDashboardData(userId: string): Promise<DashboardData> {
  const now = new Date();
  const [openShows, userOffers] = await Promise.all([
    listOpenShows(db),
    listOffersForUser(db, userId),
  ]);

  const offerByShowId = new Map<string, (typeof userOffers)[number]>();
  for (const offer of userOffers) offerByShowId.set(offer.showId, offer);

  // Union: the open shows (the horizon) + the fan's offer-shows that aren't
  // already open (e.g. an 'allocated' show with a ready ticket to lead with).
  const openIds = new Set(openShows.map((s) => s.id));
  const extraOfferShowIds = [...offerByShowId.keys()].filter(
    (id) => !openIds.has(id),
  );
  const extraShows = await listShowSummariesByIds(db, extraOfferShowIds);
  const summaries = [...openShows, ...extraShows].sort(
    (a, b) => a.doorsAt.getTime() - b.doorsAt.getTime(),
  );

  // Per-offer assignment + ticket + architecture (only for shows the fan
  // actually has an offer on — the rest never need a preview/ticket join).
  const userOfferIds = userOffers.map((o) => o.id);
  const assignmentByOfferId = await listSeatAssignmentsByOfferIds(
    db,
    userOfferIds,
  );
  const archIdsForPreview = new Set<string>();
  const assignmentIdsForTickets: string[] = [];
  for (const row of summaries) {
    const offer = offerByShowId.get(row.id);
    if (!offer) continue;
    const assignment = assignmentByOfferId.get(offer.id);
    if (!assignment) continue;
    archIdsForPreview.add(row.venueArchitectureId);
    assignmentIdsForTickets.push(assignment.id);
  }
  const [architectureById, ticketByAssignmentId] = await Promise.all([
    getVenueArchitecturesByIds(db, [...archIdsForPreview]),
    listTicketsByAssignmentIds(db, assignmentIdsForTickets),
  ]);

  const shows: ShowSummaryView[] = [];
  const heroCandidates: { hero: NowHeroView; doorsAt: Date }[] = [];
  for (const row of summaries) {
    const offer = offerByShowId.get(row.id) ?? null;
    const assignment = offer ? assignmentByOfferId.get(offer.id) ?? null : null;
    let assignmentRow: { area: string; rowName: string } | null = null;
    let ticket = null;
    if (assignment) {
      const arch = architectureById.get(row.venueArchitectureId);
      assignmentRow =
        arch?.rows.find((r) => r.id === assignment.venueRowId) ?? null;
      ticket = ticketByAssignmentId.get(assignment.id) ?? null;
    }
    const view = presentShowSummary(
      row,
      now,
      DEFAULT_TZ,
      offer,
      assignment,
      assignmentRow,
      ticket,
    );
    shows.push(view);
    if (view.yourOffer) {
      const hero = presentNowHero(row, view.yourOffer, now, DEFAULT_TZ);
      if (hero) heroCandidates.push({ hero, doorsAt: row.doorsAt });
    }
  }

  heroCandidates.sort(
    (a, b) =>
      heroPriority(a.hero) - heroPriority(b.hero) ||
      a.doorsAt.getTime() - b.doorsAt.getTime(),
  );
  const hero = heroCandidates[0]?.hero ?? null;

  return { shows, hero };
}

// Count label for the "On the horizon" section: "opens soon" while at least
// one show's window hasn't opened, else a plain count.
function horizonCount(rows: ShowSummaryView[]): string {
  const anyNotYetOpen = rows.some((s) => s.statusLabel.startsWith("Offers open "));
  if (anyNotYetOpen) return "opens soon";
  return rows.length === 1 ? "1 show" : `${rows.length} shows`;
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  const firstName = user?.firstName ?? null;
  const { shows, hero } = await loadDashboardData(userId);

  // The hero's show is shown in the band, not duplicated as a row.
  const rows = hero ? shows.filter((s) => s.id !== hero.showId) : shows;
  const yourOffers = rows.filter((s) => s.yourOffer);
  const horizon = rows.filter((s) => !s.yourOffer);

  const nothingAtAll = shows.length === 0;

  // A single rising index drives the staggered entrance across the page.
  let revealIndex = 0;
  const revealStyle = () => ({
    animationDelay: `${Math.min(revealIndex++, 6) * 55}ms`,
  });

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-4 py-12 md:px-8">
        <div className="mb-7 flex items-baseline justify-between">
          <div>
            <Eyebrow className="mb-2">Welcome back</Eyebrow>
            <h1 className="text-4xl">{firstName ? `Hi, ${firstName}` : "Shows"}</h1>
          </div>
          <span className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
            Signed in as{" "}
            <span className="font-medium" style={{ color: "var(--fg)" }}>
              {email}
            </span>
          </span>
        </div>

        {hero && <NowHero hero={hero} />}

        {nothingAtAll ? (
          // Nothing open at all — a warm, anti-FOMO block (lead with the
          // Fair/calm promise), never a dead "No data" line.
          <div
            className="auk-reveal rounded-xl p-6 font-sans"
            style={{ background: "var(--paper-2)", color: "var(--fg-muted)" }}
          >
            <p
              className="mb-1.5 font-display text-xl"
              style={{ color: "var(--fg)" }}
            >
              Nothing open right now — and that&apos;s fine.
            </p>
            <p className="text-[13px]" style={{ lineHeight: 1.55 }}>
              When an artist you follow opens offers, you&apos;ll see it here.
              There&apos;s nothing to refresh and nothing to miss — we&apos;ll
              email you the moment something opens.
            </p>
          </div>
        ) : (
          <>
            {yourOffers.length > 0 && (
              <section>
                <div className="auk-reveal" style={revealStyle()}>
                  <SectionLabel
                    label="Your offers"
                    count={`${yourOffers.length} active`}
                  />
                </div>
                <div className="flex flex-col gap-3">
                  {yourOffers.map((show) => (
                    <div
                      key={show.id}
                      className="auk-reveal"
                      style={revealStyle()}
                    >
                      <ShowRow show={show} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {horizon.length > 0 && (
              <section>
                <div className="auk-reveal" style={revealStyle()}>
                  <SectionLabel
                    label="On the horizon"
                    count={horizonCount(horizon)}
                  />
                </div>
                <div className="flex flex-col gap-3">
                  {horizon.map((show) => (
                    <div
                      key={show.id}
                      className="auk-reveal"
                      style={revealStyle()}
                    >
                      <ShowRow show={show} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Offer history link — small affordance below the show list.
            Page lists every offer the user has made across every
            show (open + past). */}
        <div className="mt-6 text-right">
          <Link
            href="/my-bids"
            className="font-sans text-[13px] no-underline"
            style={{ color: "var(--fg-muted)" }}
          >
            Offer history →
          </Link>
        </div>

        {/* "Heads up" note — on-voice (matches Change 01 §C). */}
        <div
          className="mt-6 rounded-xl p-5 font-sans text-[13px]"
          style={{
            background: "var(--paper-2)",
            color: "var(--fg-muted)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--fg)" }}>Heads up.</strong>{" "}
          Your seats are locked in 24 hours before doors. Until then it&apos;s a
          non-binding preview — you can raise an offer, never lower it. Nothing
          to refresh; we&apos;ll email you the moment anything changes.
        </div>
      </div>
    </main>
  );
}
