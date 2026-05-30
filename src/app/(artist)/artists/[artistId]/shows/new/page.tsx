// New-show page (/artists/[artistId]/shows/new). Server shell that loads the
// venues + published seat-maps the operator can build a show from, then hands
// them to the client ShowCreateForm. The form posts to POST /api/shows.
//
// `new` is a static segment sitting beside the dynamic `[showId]` — Next
// resolves the static one first, so this never shadows a real show id.

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  ShowCreateForm,
  type ShowCreateArchitecture,
  type ShowCreateVenue,
} from "@/components/artist/ShowCreateForm";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  getArtistById,
  listVenueArchitectures,
  listVenues,
  userCanManageArtist,
  userIsAdmin,
} from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ artistId: uuidParam });

type Props = {
  params: { artistId: string };
};

export default async function NewShowPage({ params }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) notFound();
  const { artistId } = parsed.data;

  // Authorization mirrors POST /api/shows: manage the artist, or be an
  // admin. 404 (not 403) so we don't leak artist existence.
  const [canManage, isAdmin, artist] = await Promise.all([
    userCanManageArtist(db, userId, artistId),
    userIsAdmin(db, userId),
    getArtistById(db, artistId),
  ]);
  if ((!canManage && !isAdmin) || !artist) notFound();

  const [venueRows, architectureRows] = await Promise.all([
    listVenues(db),
    listVenueArchitectures(db),
  ]);

  const venues: ShowCreateVenue[] = venueRows.map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city,
  }));

  // Trim the architecture rows to the fields the form renders — the full
  // VenueRow carries seat numbers, parity, lean, holds, etc. the operator
  // doesn't pick here.
  const architectures: ShowCreateArchitecture[] = architectureRows.map((a) => ({
    id: a.id,
    venueId: a.venueId,
    version: a.version,
    rows: a.rows.map((r) => ({
      id: r.id,
      area: r.area,
      section: r.section,
      rowName: r.rowName,
      tier: r.tier ?? null,
      capacity: r.capacity,
    })),
  }));

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[640px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">{artist.name}</Eyebrow>
          <h1 className="text-4xl">Create a show</h1>
        </div>
        <ShowCreateForm
          artistId={artistId}
          venues={venues}
          architectures={architectures}
        />
      </div>
    </main>
  );
}
