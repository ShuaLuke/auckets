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
import { RankBoard } from "@/components/show/RankBoard";
import { ShowHeader } from "@/components/show/ShowHeader";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getOfferStatsForShow,
  getProvisionalFilledByShow,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
  getUserRankInShowPool,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  computeShowCapacity,
  presentRankBoard,
  presentShowDetail,
  type RankBoardView,
  type ShowDetailView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

type LoadedShowDetail = {
  show: ShowDetailView;
  rankBoard: RankBoardView;
};

async function loadShowDetail(
  showId: string,
  userId: string,
): Promise<LoadedShowDetail | null> {
  // Mirrors GET /api/shows/[showId]'s loading plus the RankBoard reads.
  // See the route handler for rationale on the parallel reads and
  // conditional ticket fetch. Stats + provisionalFilled + userRank ride
  // along in the same Promise.all to keep the round-trip count flat.
  const [show, userOffer, stats, provisionalFilled, userRank] = await Promise.all([
    getShowById(db, showId),
    getOfferByShowAndUser(db, showId, userId),
    getOfferStatsForShow(db, showId),
    getProvisionalFilledByShow(db, showId),
    getUserRankInShowPool(db, showId, userId),
  ]);
  if (!show) return null;

  const userAssignment = userOffer
    ? await getSeatAssignmentByOfferId(db, userOffer.id)
    : null;
  const userTicket = userAssignment
    ? await getTicketByAssignmentId(db, userAssignment.id)
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

  return { show: view, rankBoard };
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

          {/* Right column — RankBoard ships in this slice. PreviewBanner
              + VenuePreview are the design's two remaining right-column
              components (queue item 4). The placeholder below shrinks
              to cover only those two until they land. */}
          <div className="flex flex-col gap-5">
            <RankBoard view={data.rankBoard} />
            <Card variant="warm" className="p-[18px]">
              <Eyebrow className="mb-2">Live preview</Eyebrow>
              <p
                className="font-sans text-[13px]"
                style={{ color: "var(--ink-500)", lineHeight: 1.55 }}
              >
                Where your offer would land — venue map + provisional
                row + seat highlights — lights up here once the
                preview-allocation slice ships.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
