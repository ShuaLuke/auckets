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
import { ShowHeader } from "@/components/show/ShowHeader";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getSeatAssignmentByOfferId,
  getShowById,
  getTicketByAssignmentId,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowDetail,
  type ShowDetailView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

async function loadShowDetail(
  showId: string,
  userId: string,
): Promise<ShowDetailView | null> {
  // Mirrors GET /api/shows/[showId]'s loading. See the route handler
  // for rationale on the parallel reads and conditional ticket fetch.
  const [show, userOffer] = await Promise.all([
    getShowById(db, showId),
    getOfferByShowAndUser(db, showId, userId),
  ]);
  if (!show) return null;

  const userAssignment = userOffer
    ? await getSeatAssignmentByOfferId(db, userOffer.id)
    : null;
  const userTicket = userAssignment
    ? await getTicketByAssignmentId(db, userAssignment.id)
    : null;

  const now = new Date();
  return presentShowDetail(
    show,
    now,
    DEFAULT_TZ,
    userOffer,
    userAssignment,
    userTicket,
  );
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

  const show = await loadShowDetail(parsed.data.showId, userId);
  if (!show) notFound();

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div
        className="mx-auto px-8 pb-16 pt-8"
        style={{ maxWidth: 1100 }}
      >
        <ShowHeader show={show} />

        <div
          className="grid items-start gap-6"
          style={{ gridTemplateColumns: "380px 1fr" }}
        >
          <OfferComposer
            show={show}
            existingOffer={show.yourOffer ?? null}
          />

          {/* Right column — live preview, venue map, rank board live
              here in the prototype (Show.jsx right column). Those
              need synthetic placement math that doesn't reflect
              real allocation. Slice 11+ wires them up. For now a
              placeholder card keeps the layout honest. */}
          <div className="flex flex-col gap-5">
            <Card variant="warm" className="p-[18px]">
              <Eyebrow className="mb-2">Live preview</Eyebrow>
              <p
                className="font-sans text-[13px]"
                style={{ color: "var(--ink-500)", lineHeight: 1.55 }}
              >
                Where your offer would land — venue map + ranked
                position — lights up here once the live-preview
                allocation slice ships.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
