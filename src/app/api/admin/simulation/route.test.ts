/** @vitest-environment node */
// POST /api/admin/simulation — auth → authorization → validation → a real
// engine run on a library venue. Auth and the access check are mocked; the
// simulator itself is not, so this also proves the static library loads.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("@/lib/db", () => ({ db: {} }));
const canSimulate = vi.fn();
vi.mock("@/lib/simulation/access", () => ({ userCanSimulate: (...args: unknown[]) => canSimulate(...args) }));

const post = (body: unknown): Promise<Response> => POST(new Request("http://x/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

const good = { venue: "copes-place", pool: { kind: "generate", seed: 1, oversubscription: 1.3, groupSizeMix: "couples" }, policies: ["greedy", "clean-fit"], seeds: 3 };

describe("POST /api/admin/simulation", () => {
  beforeEach(() => {
    authMock.mockReset();
    canSimulate.mockReset();
    authMock.mockResolvedValue({ userId: "user_1" });
    canSimulate.mockResolvedValue({ allowed: true, isAdmin: true });
  });

  it("401 without a session, 403 without access", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect((await post(good)).status).toBe(401);
    authMock.mockResolvedValue({ userId: "user_1" });
    canSimulate.mockResolvedValue({ allowed: false, isAdmin: false });
    expect((await post(good)).status).toBe(403);
  });

  it("400 on a bad body, 404 on an unknown venue, 422 over the allocation limit", async () => {
    expect((await post({ ...good, policies: ["nope"] })).status).toBe(400);
    expect((await post({ ...good, pool: { ...good.pool, groupSizeMix: { "1": 50, "2": 40 } } })).status).toBe(400);
    expect((await post({ ...good, venue: "nowhere" })).status).toBe(404);
    const big = await post({ ...good, seeds: 20, policies: ["greedy", "clean-fit", "lookahead", "parity-tiebreak"], timeline: { windowDays: 14, previewEveryHours: 1 } });
    expect(big.status).toBe(422);
  });

  it("runs the engine and returns the report, per-policy downloads, and a slim output", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; output: { runs: { policy: string; result?: unknown }[]; aggregates: { policy: string }[] }; reportMd: string; offersCsv: Record<string, string>; seatmapTxt: Record<string, string>; seatMaps: Record<string, { rows: { seats: number[] }[]; offers: { priceCents: number }[]; placedSeats: number }> };
    expect(body.ok).toBe(true);
    expect(body.output.aggregates.map((a) => a.policy)).toEqual(["greedy", "clean-fit"]);
    expect(body.output.runs).toHaveLength(6);
    expect(body.output.runs.every((r) => r.result === undefined)).toBe(true);
    expect(body.reportMd).toContain("## FILL REPORT — policy `greedy`");
    expect(body.reportMd).toContain("## Policies compared");
    expect(Object.keys(body.offersCsv)).toEqual(["greedy", "clean-fit"]);
    expect(body.seatmapTxt.greedy).toContain("Seat map — Cope's place");
    // The visual seat map: one per policy, every occupied seat resolves to a price.
    expect(Object.keys(body.seatMaps)).toEqual(["greedy", "clean-fit"]);
    const map = body.seatMaps.greedy!;
    const occupied = map.rows.flatMap((r) => r.seats).filter((s) => s >= 0);
    expect(occupied).toHaveLength(map.placedSeats);
    expect(occupied.every((s) => (map.offers[s]?.priceCents ?? 0) > 0)).toBe(true);
  });

  it("runs a stadium, and leaves out the downloads that would not fit in the response", async () => {
    const res = await post({ venue: "daikin-park", pool: { kind: "generate", seed: 1, oversubscription: 0.6, groupSizeMix: "couples" }, policies: ["greedy", "parity-tiebreak", "clean-fit"], seeds: 1 });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeLessThan(4_000_000); // Vercel's response limit is 4.5 MB
    const body = JSON.parse(text) as { output: { aggregates: { policy: string }[] }; reportMd: string; offersCsv: Record<string, string>; seatmapTxt: Record<string, string>; seatMaps: Record<string, unknown>; downloadsOmitted: string[]; seatMapsOmitted: string[] };
    expect(body.output.aggregates.map((a) => a.policy)).toEqual(["greedy", "parity-tiebreak", "clean-fit"]);
    expect(body.reportMd).toContain("Daikin Park");
    expect(Object.keys(body.offersCsv)).toEqual(["greedy", "parity-tiebreak"]);
    expect(Object.keys(body.seatmapTxt)).toEqual(["greedy", "parity-tiebreak"]);
    expect(body.downloadsOmitted).toEqual(["clean-fit"]);
    // The visual seat map is the first thing to go: none fits beside two policies' files.
    expect(Object.keys(body.seatMaps)).toEqual([]);
    expect(body.seatMapsOmitted).toEqual(["greedy", "parity-tiebreak", "clean-fit"]);
  }, 60_000);

  it("sells part of a stadium by area, and 422s a stadium run that would not finish in time", async () => {
    const part = await post({ venue: "daikin-park", activeSections: ["diamond_club", "club"], pool: { kind: "generate", seed: 1, oversubscription: 1.25, groupSizeMix: "couples" }, policies: ["greedy", "clean-fit", "lookahead"], seeds: 2 });
    expect(part.status).toBe(200);
    const body = (await part.json()) as { output: { venueSummary: { capacity: number }[] }; seatMaps: Record<string, unknown>; downloadsOmitted: string[]; seatMapsOmitted: string[] };
    expect(body.output.venueSummary[0]!.capacity).toBe(521 + 4715);
    expect(body.downloadsOmitted).toEqual([]);
    expect(body.seatMapsOmitted).toEqual([]);
    expect(Object.keys(body.seatMaps)).toEqual(["greedy", "clean-fit", "lookahead"]);

    const tooMuch = await post({ venue: "daikin-park", pool: { kind: "generate", seed: 1, oversubscription: 1.25, groupSizeMix: "couples" }, policies: ["greedy", "clean-fit", "clean-fit+singles-reserve", "lookahead"], seeds: 1 });
    expect(tooMuch.status).toBe(422);
    expect(((await tooMuch.json()) as { error: string }).error).toMatch(/about 27 s of work with 41,151 seats on sale/);
    const tooCrowded = await post({ venue: "daikin-park", pool: { kind: "generate", seed: 1, oversubscription: 5, groupSizeMix: "couples" }, policies: ["greedy"], seeds: 1 });
    expect(tooCrowded.status).toBe(422);
  }, 60_000);

  it("runs Cope's real pool from the library, ignoring seeds", async () => {
    const res = await post({ venue: "lincoln-v4", pool: { kind: "library", name: "lincoln-pool-v4" }, policies: ["greedy"], seeds: 10 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: { runs: unknown[]; offerSummary: { offers: number } }; reportMd: string };
    expect(body.output.runs).toHaveLength(1);
    expect(body.output.offerSummary.offers).toBe(512);
    expect(body.reportMd).toContain("| Seats filled | 1,133 |");
  });

  it("accepts the timeline and Bleacher options", async () => {
    const res = await post({ ...good, seeds: 1, bleacher: { sharePct: 10, priceCents: 2000 }, timeline: { windowDays: 2, previewEveryHours: 24, returnsSharePct: 10, refill: "keep-pool-live", upgrades: { requestSharePct: 20, acceptRatePct: 50, premiumPct: 25 } } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reportMd: string };
    expect(body.reportMd).toContain("### Timeline");
    expect(body.reportMd).toContain("### Bleacher carve-out");
  });
});
