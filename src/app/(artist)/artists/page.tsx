// /artists — a member's own roster of the acts they manage. The "many →
// roster" destination for the single "Artist" nav tab: an artist member who
// belongs to more than one act lands here and picks which to open; a member
// with exactly one act is sent straight into it by the nav (and, defensively,
// here too).
//
// This is the membership-scoped sibling of /admin/artists (which lists every
// act on the platform for admins). It sources rows from
// listArtistMembershipsForUser — never the whole roster — so it reveals only
// the acts the signed-in user actually belongs to. Each artist page re-checks
// userCanManageArtist server-side, so this is a convenience index, not a grant.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import { listArtistMembershipsForUser } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

export default async function ArtistsIndexPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const artists = await listArtistMembershipsForUser(db, userId);

  // No memberships → nothing to show here; the dashboard is home.
  if (artists.length === 0) redirect("/dashboard");
  // Exactly one → skip the picker and open it directly.
  if (artists.length === 1) redirect(`/artists/${artists[0]!.id}`);

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Your acts</Eyebrow>
          <h1 className="text-4xl">Artists</h1>
          <p
            className="mt-1 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            {artists.length} acts you manage. Click one to open its dashboard
            and shows.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {artists.map((artist) => (
            <Link
              key={artist.id}
              href={`/artists/${artist.id}`}
              className="flex items-center justify-between rounded-xl px-5 py-4 no-underline transition-colors"
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--border)",
              }}
            >
              <span className="text-lg" style={{ color: "var(--ink-900)" }}>
                {artist.name}
              </span>
              <span
                className="font-sans text-[13px]"
                style={{ color: "var(--fg-muted)" }}
              >
                Manage →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
