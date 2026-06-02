// Fan post-binding result route — /allocation/[showId].
//
// Flow: auth → validate showId → resolve the caller's OWN offer for this show
// (offer → seat_assignment → architecture row → ticket) → assemble the per-show
// result context (pool size, capacity, tier ranks, marginal price, card-failure
// recovery) → present → render with a real venue RoomMap.
//
// Authorization is structural: getOfferByShowAndUser filters by the calling
// userId, so a fan can only ever load their own outcome. The presenter gates
// on a *final* (post-binding) status — placed/charged, card_failure, or
// unplaced — and returns null for anything pre-binding; null is a 404, same as
// a missing offer. We don't distinguish "not yours" from "no result yet."

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  AllocationResult,
  type RoomMapData,
} from "@/components/allocation/AllocationResult";
import { db } from "@/lib/db";
import {
  getMarginalPlacedPriceForShow,
  getOfferByShowAndUser,
  getOfferStatsForShow,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
  listSeatAssignmentsForShow,
} from "@/lib/db/repositories";
import { env } from "@/lib/env";
import {
  buildTierMinRowRank,
  computeShowCapacity,
  DEFAULT_TZ,
  presentAllocationFinal,
  presentCardFailureRecovery,
  presentFanVenuePreview,
  type AllocationResultContext,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ showId: uuidParam });

export default async function AllocationPage({
  params,
}: {
  params: { showId: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) notFound();

  const show = await getShowById(db, parsed.data.showId);
  if (!show) notFound();

  // Caller's own offer for this show (filtered by userId in the repo).
  const offer = await getOfferByShowAndUser(db, parsed.data.showId, userId);
  if (!offer) notFound();

  const seat = await getSeatAssignmentByOfferId(db, offer.id);

  // Resolve the architecture row for the placed seat so the hero seat line can
  // name "Orchestra · Row AA".
  const row = seat
    ? show.venueArchitecture.rows.find((r) => r.id === seat.venueRowId) ?? null
    : null;

  // A ticket only exists for a binding seat (and only after T-48h issuance).
  const ticket = seat ? await getTicketByAssignmentId(db, seat.id) : null;
  const ticketReady =
    ticket?.status === "issued" || ticket?.status === "scanned";

  const now = new Date();

  // The per-show context the result copy needs. The fan-facing numbers (pool
  // size, capacity) plus the data the A/B decision and edge states rely on.
  const [stats, marginalPlacedCents, assignments] = await Promise.all([
    getOfferStatsForShow(db, parsed.data.showId),
    getMarginalPlacedPriceForShow(db, parsed.data.showId),
    listSeatAssignmentsForShow(db, parsed.data.showId),
  ]);

  // activeRowIds is jsonb (typed unknown by Drizzle); it's notNull in the
  // schema, so a show always carries the real subset of active rows.
  const activeRowIds = (show.activeRowIds ?? []) as string[];
  const capacity = computeShowCapacity(show.venueArchitecture, activeRowIds);

  const context: AllocationResultContext = {
    poolCount: stats.count,
    capacity,
    tierMinRowRank: buildTierMinRowRank(
      show.venueArchitecture.rows,
      activeRowIds,
    ),
    marginalPlacedCents,
    cardFailure: presentCardFailureRecovery(
      offer,
      seat,
      now,
      env.CARD_FAILURE_RECOVERY_WINDOW_MINUTES,
    ),
  };

  const view = presentAllocationFinal(
    show,
    offer,
    seat,
    row,
    ticketReady,
    context,
    now,
    DEFAULT_TZ,
  );
  if (!view) notFound();

  // The RoomMap: real venue rows + the show's real seat-assignment fill. The
  // fan's own binding seat is highlighted; an unplaced fan sees a full house
  // with no "yours" cells.
  const userAssignment = seat?.isBinding ? seat : null;
  const preview = presentFanVenuePreview(
    show.venueArchitecture,
    activeRowIds,
    assignments,
    userAssignment,
  );
  const roomMap: RoomMapData = {
    sections: preview.sections,
    venueName: show.venue.name,
    capacity,
  };

  return <AllocationResult view={view} roomMap={roomMap} />;
}
