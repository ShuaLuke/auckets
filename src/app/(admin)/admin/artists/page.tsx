// /admin/artists — the Artists section of the ops command center. A flat,
// admin-only roster of every artist on the platform, each row drilling into
// that artist's dashboard (/artists/[artistId]) and, from there, their
// shows.
//
// Why this exists: the site nav used to render one tab per artist for an
// admin (listArtistsManageableByUser returns the whole roster for admins),
// which floods the header the moment there's more than one act. The nav now
// gives admins a single "Artists" link that lands here instead; per-artist
// tabs are reserved for actual artist members (membership-based).
//
// Authorization: notFound() on non-admin so the route's existence doesn't
// leak. Same posture as /admin, /admin/requests, /admin/staff.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import { listAllArtists, userIsAdmin } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

const navInactive: React.CSSProperties = {
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
};
const navActive: React.CSSProperties = {
  background: "var(--ink-900)",
  color: "var(--paper)",
};

// Section nav (Shows · Artists · Requests · Staff) mirrors the other admin
// pages.
const SECTION_NAV: { label: string; href: string }[] = [
  { label: "Shows", href: "/admin" },
  { label: "Artists", href: "/admin/artists" },
  { label: "Requests", href: "/admin/requests" },
  { label: "Staff", href: "/admin/staff" },
];

export default async function AdminArtistsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!(await userIsAdmin(db, userId))) notFound();

  const artists = await listAllArtists(db);
  const count = artists.length;
  const word = count === 1 ? "artist" : "artists";

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Auckets ops</Eyebrow>
          <h1 className="text-4xl">Artists</h1>
          <p
            className="mt-1 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            {count} {word} on the platform. Click one to open its dashboard
            and shows.
          </p>
        </div>

        <div className="mb-6 flex items-center gap-1">
          {SECTION_NAV.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="rounded-full px-3 py-1.5 font-sans text-[13px]"
              style={tab.href === "/admin/artists" ? navActive : navInactive}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {count === 0 ? (
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            No artists yet.
          </div>
        ) : (
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
        )}
      </div>
    </main>
  );
}
