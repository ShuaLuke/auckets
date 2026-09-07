// /admin/simulation — the Simulation section of the ops command center
// (docs/GAE_SIMULATOR.md; REMAINING_WORK "Simulation" tab). Run the real
// allocation engine on a library venue with a synthetic or sample crowd and
// read the fill report. Nothing is written.
//
// Authorization: AUCKETS_ADMIN, or anyone who manages an artist (Cope). The
// other admin sections stay admin-only, so a non-admin artist sees only this
// tab's pill. notFound() for everyone else so the route doesn't leak.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SimulationLab } from "@/components/admin/SimulationLab";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import { GROUP_MIX_PRESETS } from "@/lib/sim/demand";
import { libraryPoolSummaries, libraryVenueSummaries } from "@/lib/sim/library";
import { userCanSimulate } from "@/lib/simulation/access";

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

export default async function AdminSimulationPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const access = await userCanSimulate(db, userId);
  if (!access.allowed) notFound();

  const venues = libraryVenueSummaries();
  const pools = libraryPoolSummaries();
  const presets = Object.fromEntries(Object.entries(GROUP_MIX_PRESETS).map(([k, v]) => [k, v as Record<string, number>]));

  return (
    <main className="min-h-[calc(100vh-57px)]" style={{ background: "var(--paper)" }}>
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Auckets ops</Eyebrow>
          <h1 className="text-4xl">Simulation</h1>
          <p className="mt-1 font-sans text-sm" style={{ color: "var(--fg-muted)" }}>
            Run the allocation engine on a venue with a crowd you describe, and see how it fills. Nothing here touches a real show.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-1">
          {access.isAdmin && (
            <>
              <Link href="/admin" className="rounded-full px-3 py-1.5 font-sans text-[13px]" style={navInactive}>
                Shows
              </Link>
              <Link href="/admin/artists" className="rounded-full px-3 py-1.5 font-sans text-[13px]" style={navInactive}>
                Artists
              </Link>
              <Link href="/admin/requests" className="rounded-full px-3 py-1.5 font-sans text-[13px]" style={navInactive}>
                Requests
              </Link>
              <Link href="/admin/staff" className="rounded-full px-3 py-1.5 font-sans text-[13px]" style={navInactive}>
                Staff
              </Link>
            </>
          )}
          <span className="rounded-full px-3 py-1.5 font-sans text-[13px]" style={navActive}>
            Simulation
          </span>
        </div>

        <SimulationLab venues={venues} pools={pools} presets={presets} />
      </div>
    </main>
  );
}
