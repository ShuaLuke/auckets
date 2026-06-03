// Fan-side show detail — Change 04. The venue map + live "right now, you'd be
// in {tier}" projection is the centerpiece; the offer is a price dial the fan
// turns and watches (LivePreviewComposer). Server component for the shell +
// first-paint data; the composer is the client island.
//
// The composer owns the map, the standing line, the dial, the express path,
// and the (unchanged) submission. This page just loads the first-paint inputs:
// the base venue fill (other fans' seats), the fan's seeded projection (from
// their existing offer, if any), and the show detail.

import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { CardFailureRecovery } from "@/components/show/CardFailureRecovery";
import { DisplacementAlerts } from "@/components/show/DisplacementAlerts";
import { LivePreviewComposer } from "@/components/show/LivePreviewComposer";
import { ShowHeader } from "@/components/show/ShowHeader";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  getMarginalPlacedPriceForShow,
  getOfferByShowAndUser,
  getProvisionalFilledByShow,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
  listSeatAssignmentsForShow,
  listUnacknowledgedDisplacementEventsForUser,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  computeShowCapacity,
  presentCardFailureRecovery,
  presentDisplacementEvents,
  presentFanVenuePreview,
  presentLiveProjection,
  presentMinToGetIn,
  presentShowDetail,
  type CardFailureRecoveryView,
  type DisplacementAlertView,
  type FanSection,
  type LiveProjectionView,
  type MinToGetInView,
  type ShowDetailView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ showId: uuidParam });

type LoadedShowDetail = {
  show: ShowDetailView;
  minToGetIn: MinToGetInView;
  baseSections: readonly FanSection[];
  capacity: number;
  venueName: string;
  initialProjection: LiveProjectionView | null;
  displacementAlerts: DisplacementAlertView[];
  cardFailureRecovery: CardFailureRecoveryView | null;
};

async function loadShowDetail(
  showId: string,
  userId: string,
): Promise<LoadedShowDetail | null> {
  const [
    show,
    userOffer,
    provisionalFilled,
    allAssignments,
    unackedEvents,
    marginalPlacedCents,
  ] = await Promise.all([
    getShowById(db, showId),
    getOfferByShowAndUser(db, showId, userId),
    getProvisionalFilledByShow(db, showId),
    listSeatAssignmentsForShow(db, showId),
    listUnacknowledgedDisplacementEventsForUser(db, userId),
    getMarginalPlacedPriceForShow(db, showId),
  ]);
  if (!show) return null;

  const userAssignment = userOffer
    ? await getSeatAssignmentByOfferId(db, userOffer.id)
    : null;
  const userTicket = userAssignment
    ? await getTicketByAssignmentId(db, userAssignment.id)
    : null;
  const userAssignmentRow = userAssignment
    ? show.venueArchitecture.rows.find((r) => r.id === userAssignment.venueRowId) ??
      null
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
  const minToGetIn = presentMinToGetIn(
    marginalPlacedCents,
    view.tierFloorsCents,
    provisionalFilled,
    capacity,
  );

  // Base map = every OTHER fan's seats (the caller's own seats are shown live
  // as the projection highlight, so we drop them from the base fill to avoid
  // double-marking them as "taken").
  const baseAssignments = userOffer
    ? allAssignments.filter((a) => a.offerId !== userOffer.id)
    : allAssignments;
  const baseSections = presentFanVenuePreview(
    show.venueArchitecture,
    show.activeRowIds as string[],
    baseAssignments,
    null,
  ).sections;

  // First-paint projection: seed from the fan's existing placement so a
  // returning fan sees their seats immediately. No GAE run on load — the
  // client re-projects the live state ~250ms after mount. Closed window →
  // calm "unavailable" so the composer degrades gracefully.
  let initialProjection: LiveProjectionView | null = null;
  if (show.status !== "open") {
    initialProjection = { available: false, reason: "closed" };
  } else if (userOffer && userAssignment && userAssignmentRow) {
    initialProjection = presentLiveProjection({
      pricePerTicketCents: userOffer.pricePerTicketCents,
      groupSize: userOffer.groupSize,
      tierPreference: userOffer.tierPreference,
      preferredTier: userOffer.preferredTier,
      projection: {
        placed: true,
        tier: userAssignment.tier,
        venueRowId: userAssignment.venueRowId,
        seatNumbers: userAssignment.seatNumbers,
      },
      rowName: userAssignmentRow.rowName,
      tierFloorsCents: view.tierFloorsCents,
    });
  }

  const displacementAlerts = presentDisplacementEvents(
    unackedEvents.filter((e) => e.showId === showId),
  );
  const cardFailureRecovery = presentCardFailureRecovery(
    userOffer,
    userAssignment,
    now,
    env.CARD_FAILURE_RECOVERY_WINDOW_MINUTES,
  );

  return {
    show: view,
    minToGetIn,
    baseSections,
    capacity,
    venueName: show.venue.name,
    initialProjection,
    displacementAlerts,
    cardFailureRecovery,
  };
}

type Props = { params: { showId: string } };

export default async function ShowPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
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
      <div className="mx-auto px-4 pb-16 pt-8 md:px-8" style={{ maxWidth: 900 }}>
        <ShowHeader show={data.show} minToGetIn={data.minToGetIn} />

        {data.cardFailureRecovery && (
          <CardFailureRecovery view={data.cardFailureRecovery} />
        )}

        {data.displacementAlerts.length > 0 && (
          <div className="mb-5">
            <DisplacementAlerts alerts={data.displacementAlerts} />
          </div>
        )}

        <LivePreviewComposer
          show={data.show}
          existingOffer={data.show.yourOffer ?? null}
          sections={data.baseSections}
          venueName={data.venueName}
          capacity={data.capacity}
          initialProjection={data.initialProjection}
        />
      </div>
    </main>
  );
}
