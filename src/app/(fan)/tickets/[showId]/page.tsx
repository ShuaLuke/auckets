// Fan ticket route — /tickets/[showId].
//
// Flow: auth → validate showId → resolve the caller's OWN paid seat for this
// show (offer → seat_assignment → ticket) → present → render TicketViewer.
//
// Authorization is structural: getOfferByShowAndUser filters by the calling
// userId, so a fan can only ever load their own ticket. Anything missing in
// the chain (no offer, not a bound seat, no issued ticket) is a 404 — we
// don't distinguish "not yours" from "doesn't exist" to a fan.

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { TicketViewer } from "@/components/ticket/TicketViewer";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
} from "@/lib/db/repositories";
import { presentTicketView } from "@/lib/presenters/ticket";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ showId: uuidParam });

export default async function TicketPage({
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

  // Only a binding (paid) seat assignment has a ticket — a preview placement
  // (isBinding=false) must not surface a ticket.
  const seat = await getSeatAssignmentByOfferId(db, offer.id);
  if (!seat || !seat.isBinding) notFound();

  const ticket = await getTicketByAssignmentId(db, seat.id);
  if (!ticket) notFound();

  const view = presentTicketView({
    artistName: show.artist.name,
    venueName: show.venue.name,
    venueCity: show.venue.city,
    doorsAt: show.doorsAt,
    geoLat: show.venue.geoLat,
    geoLon: show.venue.geoLon,
    geoRadiusM: show.venue.geoRadiusM,
    rows: show.venueArchitecture.rows.map((r) => ({
      id: r.id,
      rowName: r.rowName,
    })),
    seatAssignment: {
      venueRowId: seat.venueRowId,
      seatNumbers: seat.seatNumbers,
      tier: seat.tier,
      chargedAmountCents: seat.chargedAmountCents,
    },
    ticket: { id: ticket.id, status: ticket.status },
  });

  return <TicketViewer view={view} />;
}
