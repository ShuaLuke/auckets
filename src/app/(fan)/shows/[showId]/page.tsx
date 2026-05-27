// Fan-side show detail / offer composer. Prototype-fidelity port of
// design/ui_kits/auckets/screens/Show.jsx — server component for the
// page shell, client component for the composer form itself.
//
// FUTURE CLEANUP: same as the Dashboard page — loading logic
// duplicates GET /api/shows/[showId]. Extract a shared
// loadShowDetailForFan(showId, userId) once a third consumer
// shows up. For now the duplication is contained.

import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { OfferComposer } from "@/components/show/OfferComposer";
import { PreviewBanner } from "@/components/show/PreviewBanner";
import { RankBoard } from "@/components/show/RankBoard";
import { ShowHeader } from "@/components/show/ShowHeader";
import { VenuePreview } from "@/components/show/VenuePreview";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getOfferStatsForShow,
  getProvisionalFilledByShow,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
  getUserRankInShowPool,
  listSeatAssignmentsForShow,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  computeShowCapacity,
  presentFanVenuePreview,
  presentPreviewBanner,
  presentRankBoard,
  presentShowDetail,
  type PreviewBannerView,
  type RankBoardView,
  type ShowDetailView,
  type VenuePreviewView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

type LoadedShowDetail = {
  show: ShowDetailView;
  rankBoard: RankBoardView;
  previewBanner: PreviewBannerView;
  venuePreview: VenuePreviewView;
  venueName: string;
};

async function loadShowDetail(
  showId: string,
  userId: string,
): Promise<LoadedShowDetail | null> {
  // Mirrors GET /api/shows/[showId]'s loading plus the right-column
  // reads (RankBoard + PreviewBanner + VenuePreview). All independent
  // queries ride along in the same Promise.all to keep the round-trip
  // count flat.
  const [
    show,
    userOffer,
    stats,
    provisionalFilled,
    userRank,
    allAssignments,
  ] = await Promise.all([
    getShowById(db, showId),
    getOfferByShowAndUser(db, showId, userId),
    getOfferStatsForShow(db, showId),
    getProvisionalFilledByShow(db, showId),
    getUserRankInShowPool(db, showId, userId),
    listSeatAssignmentsForShow(db, showId),
  ]);
  if (!show) return null;

  const userAssignment = userOffer
    ? await getSeatAssignmentByOfferId(db, userOffer.id)
    : null;
  const userTicket = userAssignment
    ? await getTicketByAssignmentId(db, userAssignment.id)
    : null;

  // Resolve the architecture row for the user's assignment so the
  // banner can render "Premium · Row A" without re-walking the rows
  // in each component.
  const userAssignmentRow = userAssignment
    ? show.venueArchitecture.rows.find(
        (r) => r.id === userAssignment.venueRowId,
      ) ?? null
    : null;

  const now = new Date();
  const view = presentShowDetail(
    show,
    now,
    DEFAULT_TZ,
    userOffer,
    userAssignment,
    userTicket,
  );

  const capacity = computeShowCapacity(
    show.venueArchitecture,
    show.activeRowIds as string[],
  );
  const rankBoard = presentRankBoard(userRank, stats, provisionalFilled, capacity);

  const previewBanner = presentPreviewBanner(
    userOffer,
    userAssignment,
    userAssignmentRow,
  );

  const venuePreview = presentFanVenuePreview(
    show.venueArchitecture,
    show.activeRowIds as string[],
    allAssignments,
    userAssignment,
  );

  return {
    show: view,
    rankBoard,
    previewBanner,
    venuePreview,
    venueName: show.venue.name,
  };
}

type Props = {
  params: { showId: string };
};

export default async function ShowPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Surface unmistakable visitor — guard against the also-rare case
  // where Clerk session exists but the local user wasn't mirrored
  // (the offer composer's POST handles ensureUserMirror; this is
  // just for symmetry with the Dashboard).
  await currentUser();

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) notFound();

  const data = await loadShowDetail(parsed.data.showId, userId);
  if (!data) notFound();

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div
        className="mx-auto px-8 pb-16 pt-8"
        style={{ maxWidth: 1100 }}
      >
        <ShowHeader show={data.show} />

        <div
          className="grid items-start gap-6"
          style={{ gridTemplateColumns: "380px 1fr" }}
        >
          <OfferComposer
            show={data.show}
            existingOffer={data.show.yourOffer ?? null}
          />

          {/* Right column — full design fidelity except for
              DisplacementToast, which needs polling/push and is a
              follow-up. Card order matches the prototype: live preview
              banner first, venue map second, RankBoard third. */}
          <div className="flex flex-col gap-5">
            <PreviewBanner view={data.previewBanner} />
            <VenuePreview view={data.venuePreview} venueName={data.venueName} />
            <RankBoard view={data.rankBoard} />
          </div>
        </div>
      </div>
    </main>
  );
}
