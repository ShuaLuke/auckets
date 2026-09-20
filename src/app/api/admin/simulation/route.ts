// POST /api/admin/simulation — run the GAE simulator on a library venue.
// Backs the /admin/simulation tab. Nothing is written: the engine runs in
// memory and the response is the fill report plus the run data the page
// keeps for comparisons and downloads.
//
// Flow: auth → authorization (admin or artist member) → Zod → bounded
// scenario → runScenario → response. Bounds keep a run inside one request:
// seeds × policies × (timeline previews) is capped so a Lincoln-sized room
// stays well under the function limit.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { checkWork } from "@/lib/sim/budget";
import { GROUP_MIX_PRESETS } from "@/lib/sim/demand";
import { libraryPool, libraryVenue } from "@/lib/sim/library";
import { POLICY_PATTERN } from "@/lib/sim/schema";
import { renderFillReport, renderOffersCsv, renderSeatMap } from "@/lib/sim/report";
import { runScenario } from "@/lib/sim/run";
import { buildSeatMapView, filterSeatMapView, summariseSections, type SeatMapView, type SectionMapView } from "@/lib/sim/seatmap";
import { slimOutput } from "@/lib/sim/sweep";
import type { RunOutput, Scenario } from "@/lib/sim/types";
import { activeRows, applyShowOverlay, SimInputError } from "@/lib/sim/venue";
import { userCanSimulate } from "@/lib/simulation/access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GroupMixSchema = z
  .record(z.string().regex(/^[1-9][0-9]?$/), z.number().min(0).max(100))
  .refine((m) => Math.abs(Object.values(m).reduce((s, v) => s + v, 0) - 100) < 0.01, { message: "group-size percentages must sum to 100" });

const BodySchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/).optional(),
  venue: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  activeSections: z.array(z.string().min(1)).max(50).optional(),
  holds: z.array(z.object({ source: z.enum(["venue", "artist", "comp", "production"]), tier: z.string().min(1), seats: z.number().int().positive().max(2000) })).max(10).optional(),
  floorsCents: z.record(z.string(), z.number().int().positive().max(10_000_000)).optional(),
  maxGroupSize: z.number().int().min(1).max(20).optional(),
  pool: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("generate"),
      seed: z.number().int().min(0).max(1_000_000),
      oversubscription: z.number().min(0.1).max(5),
      groupSizeMix: z.union([z.enum(Object.keys(GROUP_MIX_PRESETS) as [string, ...string[]]), GroupMixSchema]),
      priceModel: z.enum(["ladder", "lognormal"]).optional(),
      ladderCents: z.number().int().min(100).max(100_000).optional(),
      meanStepsAboveFloor: z.number().min(0).max(30).optional(),
      tierPreferenceMix: z.object({ specific: z.number().min(0), this_or_worse: z.number().min(0), this_or_better: z.number().min(0), any: z.number().min(0) }).optional(),
      autoBidSharePct: z.number().min(0).max(100).optional(),
      privateSharePct: z.number().min(0).max(100).optional(),
      seatPrefSharePct: z.number().min(0).max(100).optional(),
    }),
    z.object({ kind: z.literal("library"), name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) }),
  ]),
  policies: z.array(z.string().regex(POLICY_PATTERN)).min(1).max(4),
  seeds: z.number().int().min(1).max(20),
  // Seat-by-seat detail for one level of one policy, for rooms whose full
  // seat map is too big to send. Nothing is kept between requests, so this
  // re-runs that policy's first seed — same inputs, same seats — and returns
  // only that level.
  detail: z.object({ policy: z.string().regex(POLICY_PATTERN), area: z.string().min(1).max(80) }).optional(),
  autoBidRaiseRule: z.union([z.object({ kind: z.literal("fixed"), cents: z.number().int().positive().max(100_000) }), z.object({ kind: z.literal("percent"), pct: z.number().positive().max(100) })]).optional(),
  bleacher: z.object({ sharePct: z.number().positive().max(50), priceCents: z.number().int().positive().max(1_000_000) }).optional(),
  timeline: z
    .object({
      windowDays: z.number().positive().max(30),
      arrival: z.enum(["uniform", "front-loaded", "last-day-spike", "s-curve"]).optional(),
      previewEveryHours: z.number().min(1).max(168).optional(),
      revisionsSharePct: z.number().min(0).max(100).optional(),
      withdrawalsSharePct: z.number().min(0).max(100).optional(),
      rollingConfirmedHours: z.number().positive().max(720).optional(),
      returnsSharePct: z.number().min(0).max(100).optional(),
      refill: z.enum(["release", "keep-pool-live"]).optional(),
      upgrades: z.object({ requestSharePct: z.number().min(0).max(100), acceptRatePct: z.number().min(0).max(100), premiumPct: z.number().min(0).max(500) }).optional(),
    })
    .optional(),
});

export type SimulationRequest = z.infer<typeof BodySchema>;

export type SimulationResponse = {
  ok: true;
  output: RunOutput; // slim: per-seed engine output dropped except the first seed's
  reportMd: string;
  offersCsv: Record<string, string>; // policy → csv
  seatmapTxt: Record<string, string>;
  seatMaps: Record<string, SeatMapView>; // policy → the visual seat map (first seed)
  // policy → the room one block per section. Small, so every policy gets one
  // even when its seat map doesn't fit.
  sectionMaps: Record<string, SectionMapView>;
  // Policies whose offers.csv and text seat map, or whose visual seat map,
  // were left out to keep the response under the platform's size limit (a
  // stadium's come to ~5 MB a policy).
  downloadsOmitted: string[];
  seatMapsOmitted: string[];
  elapsedMs: number;
};
export type SimulationDetailResponse = { ok: true; detail: SeatMapView; elapsedMs: number };
type ErrorBody = { error: string; details?: unknown };

// Vercel rejects a function response over 4.5 MB. The report and metrics
// come first; per-policy downloads and seat maps are added while they fit
// in this many characters.
const MAX_DOWNLOAD_CHARS = 3_000_000;

export async function POST(request: Request): Promise<NextResponse<SimulationResponse | SimulationDetailResponse | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await userCanSimulate(db, userId);
  if (!access.allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) return NextResponse.json({ error: "invalid body", details: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  if (body.detail && !body.policies.includes(body.detail.policy)) return NextResponse.json({ error: `detail.policy "${body.detail.policy}" is not one of this run's policies` }, { status: 400 });

  const venue = libraryVenue(body.venue);
  if (!venue) return NextResponse.json({ error: `unknown venue "${body.venue}"` }, { status: 404 });

  const scenario: Scenario = {
    name: body.name ?? "admin-run",
    venue: body.venue,
    show: {
      ...(body.activeSections && { activeSections: body.activeSections }),
      ...(body.holds && { holds: body.holds }),
      ...(body.floorsCents && { floorsCents: body.floorsCents }),
      ...(body.maxGroupSize !== undefined && { maxGroupSize: body.maxGroupSize }),
      ...(body.bleacher && { bleacher: body.bleacher }),
    },
    pool:
      body.pool.kind === "generate"
        ? {
            generate: {
              seed: body.pool.seed,
              oversubscription: body.pool.oversubscription,
              groupSizeMix: body.pool.groupSizeMix as Scenario["pool"] extends { generate: infer G } ? (G extends { groupSizeMix: infer M } ? M : never) : never,
              priceModel: body.pool.priceModel === "lognormal" ? { kind: "lognormal", ladderCents: body.pool.ladderCents ?? 2500 } : { kind: "ladder", ladderCents: body.pool.ladderCents ?? 2500, meanStepsAboveFloor: body.pool.meanStepsAboveFloor ?? 3 },
              ...(body.pool.tierPreferenceMix && { tierPreferenceMix: body.pool.tierPreferenceMix }),
              ...(body.pool.autoBidSharePct !== undefined && body.pool.autoBidSharePct > 0 && { autoBid: { sharePct: body.pool.autoBidSharePct, capMultiplier: [1.2, 1.6] as [number, number] } }),
              ...(body.pool.privateSharePct !== undefined && body.pool.privateSharePct > 0 && { privateOffers: { sharePct: body.pool.privateSharePct, thresholdMultiplier: [1.3, 2.0] as [number, number] } }),
              ...(body.pool.seatPrefSharePct !== undefined && body.pool.seatPrefSharePct > 0 && { seatPrefs: { sharePct: body.pool.seatPrefSharePct } }),
            },
          }
        : { file: `library:${body.pool.name}` },
    // A detail request needs one policy's first seed and nothing else.
    policies: body.detail ? [body.detail.policy] : body.policies,
    seeds: body.detail || body.pool.kind === "library" ? 1 : body.seeds,
    ...(body.autoBidRaiseRule && { autoBidRaiseRule: body.autoBidRaiseRule }),
    ...(body.timeline && {
      timeline: {
        windowDays: body.timeline.windowDays,
        ...(body.timeline.arrival && { arrival: body.timeline.arrival }),
        ...(body.timeline.previewEveryHours !== undefined && { previewEveryHours: body.timeline.previewEveryHours }),
        ...(body.timeline.revisionsSharePct !== undefined && body.timeline.revisionsSharePct > 0 && { revisions: { sharePct: body.timeline.revisionsSharePct, stepsUp: [1, 2] as [number, number] } }),
        ...(body.timeline.withdrawalsSharePct !== undefined && body.timeline.withdrawalsSharePct > 0 && { withdrawals: { sharePct: body.timeline.withdrawalsSharePct } }),
        ...(body.timeline.rollingConfirmedHours !== undefined && { rollingConfirmed: { afterHours: body.timeline.rollingConfirmedHours } }),
        ...(body.timeline.returnsSharePct !== undefined && body.timeline.returnsSharePct > 0 && { returns: { sharePct: body.timeline.returnsSharePct, refill: body.timeline.refill ?? "release" } }),
        ...(body.timeline.upgrades && body.timeline.upgrades.requestSharePct > 0 && { upgrades: body.timeline.upgrades }),
      },
    }),
  };

  let pool: ReturnType<typeof libraryPool>;
  if (body.pool.kind === "library") {
    pool = libraryPool(body.pool.name);
    if (!pool) return NextResponse.json({ error: `unknown pool "${body.pool.name}"` }, { status: 404 });
  }

  // Cap the work per request, by the size of the room actually on sale: a
  // timeline multiplies the allocations by its preview count, a stadium
  // multiplies the cost of each one (see sim/budget.ts).
  let renderVenue: ReturnType<typeof applyShowOverlay>["venue"];
  try {
    renderVenue = applyShowOverlay(venue, scenario.show).venue;
  } catch (e) {
    if (e instanceof SimInputError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
  const previews = body.timeline ? Math.ceil((body.timeline.windowDays * 24) / (body.timeline.previewEveryHours ?? 12)) + 1 : 1;
  const onSaleSeats = activeRows(renderVenue).reduce((s, r) => s + r.capacity - r.holds.length, 0);
  const work = checkWork({
    onSaleSeats,
    oversubscription: pool ? pool.offers.reduce((s, o) => s + o.groupSize, 0) / Math.max(1, onSaleSeats) : body.pool.kind === "generate" ? body.pool.oversubscription : 1,
    policies: scenario.policies ?? body.policies,
    seeds: scenario.seeds ?? 1,
    previews,
  });
  if (!work.ok) return NextResponse.json({ error: work.message }, { status: 422 });

  const t0 = performance.now();
  let output: RunOutput;
  try {
    output = runScenario(pool ? { scenario, venue, poolOffers: pool.offers, poolAutoBids: pool.autoBids } : { scenario, venue });
  } catch (e) {
    if (e instanceof SimInputError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
  const elapsedMs = performance.now() - t0;

  if (body.detail) {
    const area = body.detail.area;
    const run = output.runs.find((r) => r.result);
    const full = run ? buildSeatMapView(run, renderVenue) : null;
    const detail = full ? filterSeatMapView(full, (r) => r.area === area) : null;
    if (!detail || detail.rows.length === 0) return NextResponse.json({ error: `no rows on sale in "${area}"` }, { status: 404 });
    return NextResponse.json({ ok: true, detail, elapsedMs }, { status: 200 });
  }

  const offersCsv: Record<string, string> = {};
  const seatmapTxt: Record<string, string> = {};
  // Most useful first, each kept only while it fits: offers.csv, the text
  // seat map, then the visual seat map (2.5 MB a policy at Daikin).
  const seatMaps: Record<string, SeatMapView> = {};
  const sectionMaps: Record<string, SectionMapView> = {};
  const downloadsOmitted: string[] = [];
  const seatMapsOmitted: string[] = [];
  let sentChars = 0;
  const fits = (chars: number): boolean => {
    if (sentChars + chars > MAX_DOWNLOAD_CHARS) return false;
    sentChars += chars;
    return true;
  };
  for (const run of output.runs) {
    if (!run.result) continue;
    const csv = renderOffersCsv(run, renderVenue);
    const map = renderSeatMap(run, renderVenue);
    if (fits(csv.length + map.length)) {
      offersCsv[run.policy] = csv;
      seatmapTxt[run.policy] = map;
    } else downloadsOmitted.push(run.policy);
    const view = buildSeatMapView(run, renderVenue);
    if (!view) continue;
    sectionMaps[run.policy] = summariseSections(view);
    sentChars += JSON.stringify(sectionMaps[run.policy]).length; // always sent, but it still spends budget
    if (fits(JSON.stringify(view).length)) seatMaps[run.policy] = view;
    else seatMapsOmitted.push(run.policy);
  }

  return NextResponse.json(
    { ok: true, output: slimOutput(output), reportMd: renderFillReport(output), offersCsv, seatmapTxt, seatMaps, sectionMaps, downloadsOmitted, seatMapsOmitted, elapsedMs },
    { status: 200 },
  );
}
