// Site header / primary nav. A Server Component: it reads the signed-in
// user's role server-side so it can surface the admin/artist destinations
// a plain fan never sees (the previous header only ever linked to the fan
// Dashboard, which is why an admin appeared "stuck" on the fan page).
//
// What it adds, by grant:
//   - any signed-in user → Dashboard
//   - artist members / admins → a link per manageable artist (their
//     ShowAdmin lives one click in, off the artist dashboard)
//   - AUCKETS_ADMIN → the Requests inbox + an "Admin" pill that links to
//     the ops command center (/admin)
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
  listArtistsManageableByUser,
  userIsAdmin,
} from "@/lib/db/repositories";

const linkClass = "text-sm text-neutral-700 hover:text-neutral-900";

export async function SiteNav() {
  const { userId } = await auth();
  // Skip the DB round-trips entirely for signed-out requests (e.g. the
  // landing page) — there's no role to resolve.
  const isAdmin = userId ? await userIsAdmin(db, userId) : false;
  const manageableArtists = userId
    ? await listArtistsManageableByUser(db, userId)
    : [];

  // Flat list of the signed-in role links, used by the mobile disclosure
  // menu. The desktop row renders them inline (with the Admin pill style).
  const roleLinks: { href: string; label: string }[] = [
    { href: "/dashboard", label: "Dashboard" },
    ...manageableArtists.map((artist) => ({
      href: `/artists/${artist.id}`,
      label: artist.name,
    })),
    ...(isAdmin
      ? [
          { href: "/admin/requests", label: "Requests" },
          { href: "/admin", label: "Admin" },
        ]
      : []),
  ];

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
      <Link href="/" className="font-semibold tracking-tight">
        AUCKETS
      </Link>
      <nav className="flex items-center gap-3">
        <SignedOut>
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
          {/* Desktop: the role links inline. */}
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/dashboard" className={linkClass}>
              Dashboard
            </Link>

            {manageableArtists.map((artist) => (
              <Link
                key={artist.id}
                href={`/artists/${artist.id}`}
                className={linkClass}
              >
                {artist.name}
              </Link>
            ))}

            {isAdmin && (
              <Link href="/admin/requests" className={linkClass}>
                Requests
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

          {/* Mobile: the same links collapse into a disclosure menu so a
              multi-artist or admin user's nav never overflows the row.
              Pure-CSS <details> — no client JS, so SiteNav stays a Server
              Component. */}
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

          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </nav>
    </header>
  );
}
