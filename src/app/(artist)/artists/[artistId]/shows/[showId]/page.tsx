// ShowAdmin — the artist's drill-through view of one of their own
// shows. Prototype-fidelity port of the Overview tab content from
// design/ui_kits/auckets/screens/ShowAdmin.jsx — header, BigStats
// card, and tier-breakdown card.
//
// Out of scope this slice (each lands in its own follow-up):
//   - Distribution histogram (Distribution tab)
//   - Provisional placement seat map (Provisional placement tab)
//   - Holds & manifest (Holds tab)
//   - Fans · data export table (Fans tab)
//   - Recent activity feed (right column of the Overview tab)
//   - Preview-allocation button (admin-flow slice)
//   - Request action dialog (artist-request endpoint, per ADR-0013)

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { BigStatsCard } from "@/components/artist/BigStatsCard";
import { RecentActivityCard } from "@/components/artist/RecentActivityCard";
import { ShowAdminHeader } from "@/components/artist/ShowAdminHeader";
import { TierBreakdownCard } from "@/components/artist/TierBreakdownCard";
import { db } from "@/lib/db";
import {
  getOfferStatsByTierForShow,
  getOfferStatsForShow,
  getProvisionalFilledByShow,
  getShowById,
  listRecentOffersForShow,
  userCanManageArtist,
  userIsAdmin,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistShowSummary,
  presentRecentActivity,
  presentTierBreakdown,
  type ActivityEvent,
  type ArtistShowSummaryView,
  type TierBreakdownView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: uuidParam,
  showId: uuidParam,
});

type LoadedView = {
  show: ArtistShowSummaryView;
  tiers: TierBreakdownView;
  activity: ActivityEvent[];
};

async function loadShowAdmin(
  artistId: string,
  showId: string,
): Promise<LoadedView | null> {
  const showRow = await getShowById(db, showId);
  if (!showRow) return null;
  // Defensive: the URL pairs (artistId, showId). If the show belongs to
  // a different artist, refuse — the caller has manage rights for the
  // path artist but that doesn't grant rights to a different artist's
  // show.
  if (showRow.artistId !== artistId) return null;

  const [stats, provisionalFilled, tierBuckets, recentOffers] =
    await Promise.all([
      getOfferStatsForShow(db, showId),
      getProvisionalFilledByShow(db, showId),
      getOfferStatsByTierForShow(db, showId),
      listRecentOffersForShow(db, showId, 50),
    ]);

  // Project ShowWithRelations onto the ShowSummary shape that the
  // ArtistShowSummary presenter expects. activeRowIds is stored as
  // jsonb (unknown); narrow it here, same posture as the repos do.
  const summary = {
    id: showRow.id,
    artistId: showRow.artistId,
    venueId: showRow.venueId,
    venueArchitectureId: showRow.venueArchitectureId,
    status: showRow.status,
    doorsAt: showRow.doorsAt,
    offerWindowOpensAt: showRow.offerWindowOpensAt,
    bindingAllocationAt: showRow.bindingAllocationAt,
    pausedAt: showRow.pausedAt,
    activeRowIds: showRow.activeRowIds as string[],
    artistName: showRow.artist.name,
    venueName: showRow.venue.name,
    venueCity: showRow.venue.city,
  };

  const now = new Date();
  const view = presentArtistShowSummary(
    summary,
    stats,
    provisionalFilled,
    showRow.venueArchitecture,
    summary.activeRowIds,
    now,
    DEFAULT_TZ,
  );

  return {
    show: view,
    tiers: presentTierBreakdown(tierBuckets),
    activity: presentRecentActivity(recentOffers, now, 10),
  };
}

type Props = {
  params: { artistId: string; showId: string };
};

export default async function ArtistShowAdminPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) notFound();

  // 404 over 403 — same posture as the parent ArtistDashboard, see
  // /artists/[artistId]/page.tsx for rationale.
  const allowed = await userCanManageArtist(db, userId, parsed.data.artistId);
  if (!allowed) notFound();

  // Admin gate on the Preview allocation button. ADR-0013: even artists
  // file a Request action — they don't run preview directly. The
  // /api/shows/[id]/allocate endpoint enforces this server-side
  // independently; this check just hides the button when it'd 403.
  const [data, isAdmin] = await Promise.all([
    loadShowAdmin(parsed.data.artistId, parsed.data.showId),
    userIsAdmin(db, userId),
  ]);
  if (!data) notFound();

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1200px] px-8 pb-16 pt-8">
        <ShowAdminHeader
          artistId={parsed.data.artistId}
          show={data.show}
          canRunPreview={isAdmin}
        />

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <BigStatsCard show={data.show} />
            <RecentActivityCard events={data.activity} />
          </div>
          <TierBreakdownCard breakdown={data.tiers} />
        </div>
      </div>
    </main>
  );
}
