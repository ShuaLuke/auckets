// Site header / primary nav. A Server Component: it reads the signed-in
// user's role server-side so it can surface the role "apps" a plain fan
// never sees.
//
// Model: the logo is home (→ /dashboard when signed in). Beyond it, a
// signed-in user sees only the apps they hold, at most three:
//   - Venue  → /scan, for door staff (AUCKETS_ADMIN or VENUE_STAFF)
//   - Artist → smart target: manage exactly one act → straight to it;
//     manage several (or admin = all) → a roster. Admin → /admin/artists,
//     a member with one act → /artists/<id>, a member with many → /artists.
//   - Admin  → /admin ops command center (AUCKETS_ADMIN only), dark pill.
// Requests is intentionally NOT a top-level tab — it lives as a section
// tab inside /admin. Because this header is mounted in the root layout it
// persists on every page, so it doubles as the cross-app switcher.
//
// Signed-out visitors get the public "Shows" lineup link + Sign in / up.
//
// Authorization note: these links are convenience only. Every admin and
// artist page re-checks authorization server-side (userIsAdmin /
// userCanManageArtist), and the allocate/holds/request APIs enforce it
// independently. The nav reveals destinations; it cannot grant access.
//
// Clerk's <SignedIn>/<SignedOut> still drive the auth-state toggle so the
// header reacts immediately to client-side sign-in/out. The role-derived
// links live inside <SignedIn> and are gated on the server-computed flags,
// so they only render for a signed-in, elevated user.

import {
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { Menu } from "lucide-react";
import Link from "next/link";

import { db } from "@/lib/db";
import {
  listArtistMembershipsForUser,
  userCanScan,
  userIsAdmin,
} from "@/lib/db/repositories";

const linkClass = "text-sm text-neutral-700 hover:text-neutral-900";

export async function SiteNav() {
  const { userId } = await auth();
  // Skip the DB round-trips entirely for signed-out requests (e.g. the
  // landing page) — there's no role to resolve.
  const isAdmin = userId ? await userIsAdmin(db, userId) : false;
  // Membership only — NOT listArtistsManageableByUser, whose admin branch
  // returns the whole roster and would render one tab per artist. Admins
  // reach individual artists through the "Artists" index link below.
  const memberArtists = userId
    ? await listArtistMembershipsForUser(db, userId)
    : [];
  // Door scanner: AUCKETS_ADMIN or VENUE_STAFF (ADR-0012). /scan + /api/scan
  // enforce the same check server-side — this just reveals the destination.
  const canScan = userId ? await userCanScan(db, userId) : false;

  // Where the single "Artist" tab points. Admins can manage every act, so
  // they land on the roster; a member with one act jumps straight in; a
  // member with several gets their own (membership-scoped) roster. null =
  // not shown (a plain fan with no memberships and no admin grant).
  const artistHref = isAdmin
    ? "/admin/artists"
    : memberArtists.length === 1
      ? `/artists/${memberArtists[0]!.id}`
      : memberArtists.length > 1
        ? "/artists"
        : null;

  // Flat list of the signed-in role "apps", used by the mobile disclosure
  // menu. The desktop row renders them inline (with the Admin pill style).
  const roleLinks: { href: string; label: string }[] = [
    ...(canScan ? [{ href: "/scan", label: "Venue" }] : []),
    ...(artistHref ? [{ href: artistHref, label: "Artist" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
      {/* Logo is home: the dashboard when signed in, the marketing page when
          not. No separate "Dashboard" tab — the wordmark carries it. */}
      <Link
        href={userId ? "/dashboard" : "/"}
        className="font-semibold tracking-tight"
      >
        AUCKETS
      </Link>
      <nav className="flex items-center gap-3">
        <SignedOut>
          {/* "Shows" — the public lineup, the one discovery entry point for
              signed-out visitors. /shows is public; making an offer still
              needs sign-in. Signed-in users are redirected to /dashboard. */}
          <Link href="/shows" className={linkClass}>
            Shows
          </Link>
          <SignInButton mode="modal">
            <button className={linkClass}>Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-full bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">
              Sign up
            </button>
          </SignUpButton>
        </SignedOut>
        <SignedIn>
          {/* Desktop: the role "apps" inline — Venue · Artist · Admin. */}
          <div className="hidden items-center gap-3 md:flex">
            {canScan && (
              <Link href="/scan" className={linkClass}>
                Venue
              </Link>
            )}

            {artistHref && (
              <Link href={artistHref} className={linkClass}>
                Artist
              </Link>
            )}

            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white no-underline hover:bg-neutral-700"
                title="AUCKETS ops command center"
              >
                Admin
              </Link>
            )}
          </div>

          {/* Mobile: the same role apps collapse into a disclosure menu so
              the nav never overflows the row. Pure-CSS <details> — no client
              JS, so SiteNav stays a Server Component. Omitted entirely for a
              plain fan, who holds no apps (the menu would be empty). */}
          {roleLinks.length > 0 && (
            <details className="relative md:hidden">
            <summary
              className="flex cursor-pointer list-none items-center rounded-full p-1.5 text-neutral-700 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden"
              aria-label="Open menu"
            >
              <Menu size={20} strokeWidth={1.75} aria-hidden />
            </summary>
            <div className="absolute right-0 z-20 mt-2 flex w-44 flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
              {roleLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-md px-3 py-2 text-sm text-neutral-700 no-underline hover:bg-neutral-100"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            </details>
          )}

          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </nav>
    </header>
  );
}
