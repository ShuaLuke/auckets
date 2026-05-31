/** @vitest-environment node */
// Unit tests for POST /api/shows/[showId]/transition — the direct ops
// Pause / Resume / Close endpoint. We mock the auth boundary, the db handle,
// and the repository transitions so this exercises the route's own logic:
// the auth → validate → admin-gate → dispatch → status-mapping chain. The
// guarded transitions themselves are covered in shows.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

// The route only passes `db` through to the repo functions, which are mocked
// below — so an opaque token is enough.
vi.mock("@/lib/db", () => ({ db: {} }));

const pauseShow = vi.fn();
const resumeShow = vi.fn();
const closeShow = vi.fn();
const userIsAdmin = vi.fn();
vi.mock("@/lib/db/repositories", () => ({
  pauseShow: (...args: unknown[]) => pauseShow(...args),
  resumeShow: (...args: unknown[]) => resumeShow(...args),
  closeShow: (...args: unknown[]) => closeShow(...args),
  userIsAdmin: (...args: unknown[]) => userIsAdmin(...args),
}));

const SHOW_ID = "11111111-1111-1111-1111-111111111111";

function req(body: unknown): Request {
  return new Request("http://test/api/shows/x/transition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = { params: { showId: SHOW_ID } };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "user_admin" });
  userIsAdmin.mockResolvedValue(true);
});

describe("POST /api/shows/[showId]/transition", () => {
  it("401s when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await POST(req({ action: "pause" }), params);
    expect(res.status).toBe(401);
    expect(pauseShow).not.toHaveBeenCalled();
  });

  it("400s on a non-uuid showId", async () => {
    const res = await POST(req({ action: "pause" }), {
      params: { showId: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    expect(userIsAdmin).not.toHaveBeenCalled();
  });

  it("400s on malformed JSON body", async () => {
    const res = await POST(req("{not json"), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid body" });
  });

  it("400s on an unknown action", async () => {
    const res = await POST(req({ action: "destroy" }), params);
    expect(res.status).toBe(400);
    expect(pauseShow).not.toHaveBeenCalled();
  });

  it("403s a non-admin caller", async () => {
    userIsAdmin.mockResolvedValue(false);
    const res = await POST(req({ action: "pause" }), params);
    expect(res.status).toBe(403);
    expect(pauseShow).not.toHaveBeenCalled();
  });

  it("pauses an open show → 200 with status=paused", async () => {
    pauseShow.mockResolvedValue({ ok: true, show: { id: SHOW_ID } });
    const res = await POST(req({ action: "pause" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ showId: SHOW_ID, status: "paused" });
    // pauseShow(db, showId, now) — third arg is a Date.
    expect(pauseShow).toHaveBeenCalledTimes(1);
    expect(pauseShow.mock.calls[0]?.[1]).toBe(SHOW_ID);
    expect(pauseShow.mock.calls[0]?.[2]).toBeInstanceOf(Date);
  });

  it("resumes a paused show → 200 with status=open", async () => {
    resumeShow.mockResolvedValue({ ok: true, show: { id: SHOW_ID } });
    const res = await POST(req({ action: "resume" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ showId: SHOW_ID, status: "open" });
    expect(resumeShow).toHaveBeenCalledTimes(1);
  });

  it("closes a show → 200 with status=closed", async () => {
    closeShow.mockResolvedValue({ ok: true, show: { id: SHOW_ID } });
    const res = await POST(req({ action: "close" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ showId: SHOW_ID, status: "closed" });
    expect(closeShow).toHaveBeenCalledTimes(1);
  });

  it("maps not_found → 404", async () => {
    pauseShow.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await POST(req({ action: "pause" }), params);
    expect(res.status).toBe(404);
  });

  it("maps wrong_status → 409 naming the current status", async () => {
    resumeShow.mockResolvedValue({
      ok: false,
      reason: "wrong_status",
      status: "open",
    });
    const res = await POST(req({ action: "resume" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cannot resume show with status=open",
    });
  });
});
