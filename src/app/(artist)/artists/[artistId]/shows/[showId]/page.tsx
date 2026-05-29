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

import { FiledRequestsPanel } from "@/components/artist/FiledRequestsPanel";
import { ShowAdminHeader } from "@/components/artist/ShowAdminHeader";
import { ShowAdminTabs } from "@/components/artist/ShowAdminTabs";
import { db } from "@/lib/db";
import {
  getOfferStatsByTierForShow,
  getOfferStatsForShow,
  getPriceDistributionForShow,
  getProvisionalFilledByShow,
  getShowById,
  getVenueArchitectureById,
  listArtistRequestsForShow,
  listHoldsForShow,
  listOfferRevisionsByOfferIds,
  listPoolOffersForShow,
  listRecentAllocationLogsForShow,
  listRecentOffersForShow,
  listSeatAssignmentsForShow,
  userCanManageArtist,
  userIsAdmin,
} from "@/lib/db/repositories";
import { buildPreviewAllocationPlan } from "@/lib/allocation/build-plan";
import {
  DEFAULT_TZ,
  presentArtistRequestStatus,
  presentArtistShowSummary,
  presentHolds,
  presentPriceDistribution,
  presentProvisionalPlacement,
  presentRecentActivity,
  presentTierBreakdown,
  type ActivityEvent,
  type ArtistRequestStatusView,
  type ArtistShowSummaryView,
  type HoldsView,
  type PriceDistributionView,
  type ProvisionalPlacementView,
  type TierBreakdownView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: uuidParam,
  showId: uuidParam,
});

// Pre-binding statuses where a live preview projection is meaningful.
// Mirrors PREVIEW_ELIGIBLE_STATUSES in run-preview.ts. For these we
// compute placement in-memory on load (NEW-10: ops-only preview, but
// auto-run as a read-time projection so the artist never sees a
// stale/empty map) WITHOUT persisting — only the explicit ops
// "Run preview"/"Run binding" actions write seat_assignments/logs.
const PREVIEW_ELIGIBLE_STATUSES = new Set(["draft", "open", "paused"]);

import type { AddHoldRow } from "@/components/artist/AddHoldButton";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";

type LoadedView = {
  show: ArtistShowSummaryView;
  tiers: TierBreakdownView;
  activity: ActivityEvent[];
  placement: ProvisionalPlacementView;
  distribution: PriceDistributionView;
  holds: HoldsView;
  // Slim row projection the AddHoldButton dialog needs. Only includes
  // rows in activeRowIds (NEW-4 partial-venue activation) so the
  // dialog can't accidentally hold seats in inactive rows.
  activeHoldRows: AddHoldRow[];
  requests: ArtistRequestStatusView[];
  // True when the placement view + fill stat are a live in-memory
  // projection (no saved run), false when they reflect persisted
  // seat_assignments (a real ops preview/binding run).
  placementIsLiveProjection: boolean;
};

async function loadShowAdmin(
  artistId: string,
  showId: string,
  viewerIsAdmin: boolean,
): Promise<LoadedView | null> {
  const showRow = await getShowById(db, showId);
  if (!showRow) return null;
  // Defensive: the URL pairs (artistId, showId). If the show belongs to
  // a different artist, refuse — the caller has manage rights for the
  // path artist but that doesn't grant rights to a different artist's
  // show.
  if (showRow.artistId !== artistId) return null;

  const [
    stats,
    provisionalFilled,
    tierBuckets,
    recentOffers,
    assignments,
    recentLogs,
    distributionBuckets,
    holdRows,
    requestRows,
  ] = await Promise.all([
    getOfferStatsForShow(db, showId),
    getProvisionalFilledByShow(db, showId),
    getOfferStatsByTierForShow(db, showId),
    listRecentOffersForShow(db, showId, 50),
    listSeatAssignmentsForShow(db, showId),
    listRecentAllocationLogsForShow(db, showId, 50),
    getPriceDistributionForShow(db, showId),
    listHoldsForShow(db, showId),
    listArtistRequestsForShow(db, showId),
  ]);

  // Second-step: fetch revision history only for offers that have been
  // revised (revisedAt !== null). We need the offer IDs from the first
  // step, so this can't be parallelised with the main fetch above — but
  // it's a single indexed query on offer_revisions so it's cheap even
  // for a 50-offer show.
  const revisedOfferIds = recentOffers
    .filter((o) => o.revisedAt !== null)
    .map((o) => o.id);
  const offerHistoryByOfferId = await listOfferRevisionsByOfferIds(
    db,
    revisedOfferIds,
  );

  // Live preview projection (NEW-10). For pre-binding shows, compute
  // placement in-memory via the pure GAE so the artist's view is never
  // stale or empty — without writing anything (only explicit ops runs
  // persist). When the show is past the binding gate, fall through to
  // the persisted assignments, which are the system of record.
  let placementAssignments: readonly Pick<
    (typeof assignments)[number],
    "venueRowId" | "seatNumbers"
  >[] = assignments;
  let filledForSummary = provisionalFilled;
  let placementIsLiveProjection = false;
  if (PREVIEW_ELIGIBLE_STATUSES.has(showRow.status)) {
    const [architecture, poolOffers] = await Promise.all([
      getVenueArchitectureById(db, showRow.venueArchitectureId),
      listPoolOffersForShow(db, showId),
    ]);
    if (architecture) {
      const plan = buildPreviewAllocationPlan(showRow, architecture, poolOffers);
      placementAssignments = plan.assignmentRows;
      // Keep BigStats' fill consistent with the projected placement
      // map — both derive from the same in-memory run.
      filledForSummary = plan.assignmentRows.reduce(
        (n, r) => n + r.seatNumbers.length,
        0,
      );
      placementIsLiveProjection = true;
    }
  }

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
    filledForSummary,
    showRow.venueArchitecture,
    summary.activeRowIds,
    now,
    DEFAULT_TZ,
  );

  // Project the architecture's active rows into the slim shape
  // AddHoldButton expects. Filtering to activeRowIds ensures the
  // dialog can't accidentally hold seats in rows the show isn't
  // using (NEW-4 partial-venue activation).
  const activeRowSet = new Set(summary.activeRowIds);
  const archRows = showRow.venueArchitecture.rows as readonly GaeVenueRow[];
  const activeHoldRows: AddHoldRow[] = archRows
    .filter((r) => activeRowSet.has(r.id))
    .map((r) => ({
      id: r.id,
      rowName: r.rowName,
      area: r.area,
      section: r.section,
      seatNumbers: r.seatNumbers,
    }));

  return {
    show: view,
    tiers: presentTierBreakdown(tierBuckets),
    activity: presentRecentActivity(
      recentOffers,
      recentLogs,
      showRow.venueArchitecture,
      now,
      10,
      offerHistoryByOfferId,
    ),
    placement: presentProvisionalPlacement(
      showRow.venueArchitecture,
      summary.activeRowIds,
      placementAssignments,
    ),
    distribution: presentPriceDistribution(distributionBuckets),
    holds: presentHolds(holdRows, showRow.venueArchitecture, viewerIsAdmin),
    activeHoldRows,
    requests: requestRows.map((r) => presentArtistRequestStatus(r, now, DEFAULT_TZ)),
    placementIsLiveProjection,
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
  //
  // The admin flag also widens hold mutability — admins can delete
  // venue-kind holds; non-admin artist members can't. The server
  // route re-enforces both checks independently.
  const isAdmin = await userIsAdmin(db, userId);
  const data = await loadShowAdmin(
    parsed.data.artistId,
    parsed.data.showId,
    isAdmin,
  );
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
          canRunBinding={isAdmin}
        />

        <FiledRequestsPanel requests={data.requests} />

        <ShowAdminTabs
          showId={parsed.data.showId}
          show={data.show}
          activity={data.activity}
          tiers={data.tiers}
          distribution={data.distribution}
          placement={data.placement}
          placementIsLiveProjection={data.placementIsLiveProjection}
          holds={data.holds}
          activeHoldRows={data.activeHoldRows}
        />
      </div>
    </main>
  );
}
