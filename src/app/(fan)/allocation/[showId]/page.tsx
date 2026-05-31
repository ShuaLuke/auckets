// Fan post-binding result route — /allocation/[showId].
//
// Flow: auth → validate showId → resolve the caller's OWN offer for this show
// (offer → seat_assignment → architecture row → ticket) → present → render.
//
// Authorization is structural: getOfferByShowAndUser filters by the calling
// userId, so a fan can only ever load their own outcome. The presenter gates
// on a *final* (post-binding) status — placed/charged, card_failure, or
// unplaced — and returns null for anything pre-binding; null is a 404, same as
// a missing offer. We don't distinguish "not yours" from "no result yet."

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AllocationResult } from "@/components/allocation/AllocationResult";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
} from "@/lib/db/repositories";
import { DEFAULT_TZ, presentAllocationFinal } from "@/lib/presenters";
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

  // Resolve the architecture row for the placed seat so the card can show
  // "Row AA" alongside the tier.
  const row = seat
    ? show.venueArchitecture.rows.find((r) => r.id === seat.venueRowId) ?? null
    : null;

  // A ticket only exists for a binding seat (and only after T-48h issuance).
  const ticket = seat ? await getTicketByAssignmentId(db, seat.id) : null;
  const ticketReady =
    ticket?.status === "issued" || ticket?.status === "scanned";

  const view = presentAllocationFinal(
    show,
    offer,
    seat,
    row,
    ticketReady,
    new Date(),
    DEFAULT_TZ,
  );
  if (!view) notFound();

  return <AllocationResult view={view} />;
}
