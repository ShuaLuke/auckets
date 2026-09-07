// Who may run the Simulation tab. Not a pure module (it reads roles), so it
// lives outside src/lib/sim.
//
// AUCKETS_ADMIN (Julia, Josh) and anyone who manages an artist (Cope, via
// artist membership) can run what-ifs. The tab writes nothing — it runs the
// engine in memory on library venues and synthetic or sample pools — so
// broader read access is safe; it just isn't for fans or door staff.

import type { Db } from "@/lib/db";
import { listArtistMembershipsForUser, userIsAdmin } from "@/lib/db/repositories";

export async function userCanSimulate(db: Db, userId: string): Promise<{ allowed: boolean; isAdmin: boolean }> {
  const isAdmin = await userIsAdmin(db, userId);
  if (isAdmin) return { allowed: true, isAdmin };
  const memberships = await listArtistMembershipsForUser(db, userId);
  return { allowed: memberships.length > 0, isAdmin };
}
