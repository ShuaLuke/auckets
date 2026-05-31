// Sweep for the allocation-imminent reminder: find shows whose binding
// checkpoint is ~24h out and email every fan still holding a pool offer, so
// they can revise upward before allocation runs. Driven by the
// allocation-imminent Inngest cron.
//
// Dedup is window-based: the band [now+24h, now+24h+15m] is exactly the cron
// cadence (every 15 min), so as `now` advances each show's binding time falls
// into exactly one tick's band → each fan is reminded ~once, ~24h ahead. This
// is best-effort (a cron tick that's skipped/retried could miss or rarely
// repeat); a per-show "reminder sent" marker would make it exactly-once but
// needs a schema column — deferred.

import type { Db } from "@/lib/db";
import {
  getEmailsByUserIds,
  getShowById,
  listPoolOffersForShow,
} from "@/lib/db/repositories";
// Imported from the submodule (not the barrel) on purpose: the repositories
// index.ts had unrelated parallel WIP when this landed, so keeping the import
// off the barrel avoided entangling the two changes. Fine to fold into the
// barrel later.
import { listShowIdsWithBindingBetween } from "@/lib/db/repositories/shows";
import { logger } from "@/lib/logger";
import { notifyAllocationImminent } from "@/lib/notifications/fan";

const WINDOW_AHEAD_MS = 24 * 60 * 60 * 1000; // remind ~24h before binding
const BAND_MS = 15 * 60 * 1000; // == the cron interval

export async function sweepAllocationImminent(
  db: Db,
  now: Date,
): Promise<{ shows: number; fans: number }> {
  const from = new Date(now.getTime() + WINDOW_AHEAD_MS);
  const to = new Date(from.getTime() + BAND_MS);
  const showIds = await listShowIdsWithBindingBetween(db, from, to);

  let fans = 0;
  for (const showId of showIds) {
    const show = await getShowById(db, showId);
    if (!show) continue;
    const pool = await listPoolOffersForShow(db, showId);
    const userIds = [...new Set(pool.map((o) => o.userId))];
    if (userIds.length === 0) continue;

    const emailByUser = await getEmailsByUserIds(db, userIds);
    const ctx = {
      showId,
      artistName: show.artist.name,
      showName: show.venue.name,
      doorsAt: show.doorsAt,
    };
    await Promise.all(
      userIds.map((uid) => {
        const to2 = emailByUser.get(uid);
        if (!to2) return Promise.resolve();
        return notifyAllocationImminent(ctx, {
          to: to2,
          bindingAt: show.bindingAllocationAt,
        });
      }),
    );
    fans += userIds.length;
  }

  logger.info(
    { event: "allocation_imminent.swept", shows: showIds.length, fans },
    "allocation-imminent sweep complete",
  );
  return { shows: showIds.length, fans };
}
