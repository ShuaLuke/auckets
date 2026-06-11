// Public shows index — /shows. The browsable lineup of every announced show,
// reachable WITHOUT signing in (added to the middleware public allowlist).
// Discovery surface for signed-out visitors: a link anyone can open to see
// what's on; making an offer still requires sign-in (clicking a card →
// /shows/[showId] → the composer, which is auth-gated).
//
// Signed-in users are redirected to /dashboard, which is the same lineup plus
// their own offer status — so /shows is the signed-out face of the dashboard,
// not a second destination they can land on.
//
// "Show both" (Julia, 2026-05-31): listOpenShows returns status='open' shows,
// which includes ones whose offer window hasn't opened yet (e.g. a show that
// opens next week). presentShowSummary already labels those "Offers open Jun
// 05", so biddable-now and coming-soon shows render side by side, each clearly
// marked. Truly unannounced ('draft') shows are intentionally excluded.
//
// No user context here (the page is public), so presentShowSummary is called
// without an offer — ShowRow then renders the show identity + status with no
// "your offer" badge, and links to the show page.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { listOpenShows } from "@/lib/db/repositories";
import { DEFAULT_TZ, presentShowSummary } from "@/lib/presenters";
import { ShowRow } from "@/components/dashboard/ShowRow";

export const dynamic = "force-dynamic";

export default async function ShowsIndexPage() {
  // Signed-in users belong on /dashboard (the same lineup + their offers).
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const now = new Date();
  const summaries = await listOpenShows(db);
  const shows = summaries.map((s) => presentShowSummary(s, now, DEFAULT_TZ));

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[960px] px-4 py-10 md:px-8">
        <header className="mb-8">
          <h1
            className="font-display"
            style={{
              fontSize: "var(--text-4xl)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Shows
          </h1>
          <p
            className="font-sans"
            style={{ fontSize: 14, color: "var(--ink-600)", marginTop: 4 }}
          >
            Every announced show. Make an offer on the ones you want to see.
          </p>
        </header>

        {shows.length === 0 ? (
          <div
            className="rounded-xl border px-6 py-12 text-center"
            style={{ background: "var(--page)", borderColor: "var(--border)" }}
          >
            <p
              className="font-sans"
              style={{ fontSize: 15, color: "var(--ink-600)" }}
            >
              No shows announced yet — the next one will land here first.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shows.map((show) => (
              <ShowRow key={show.id} show={show} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
