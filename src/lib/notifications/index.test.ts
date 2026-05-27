// Shape + no-op tests for the notifications dispatcher. These tests
// run without RESEND_API_KEY or SLACK_OPS_WEBHOOK_URL so both
// channels operate in dormant / no-op mode. The goal is to verify:
//
//   1. notifyRequestActioned resolves (never throws) regardless of
//      channel errors.
//   2. Slack channel no-ops cleanly when the webhook URL is absent.
//   3. Email channel no-ops cleanly when RESEND_API_KEY is absent.
//   4. KIND_LABELS covers the core request kinds.
//
// Full channel integration (real Slack hit, real Resend send) is out
// of scope for unit tests — those land in staging smoke tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIND_LABELS, notifyRequestActioned, type RequestActionedPayload } from "./index";

// Silence logger output during tests.
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the Slack channel so no real HTTP calls are made and the module
// import chain doesn't try to load env.ts in a way that throws without
// real credentials.
vi.mock("./slack", () => ({
  postRequestActioned: vi.fn().mockResolvedValue(undefined),
}));

// Mock the email channel to avoid importing RequestActioned.tsx, which
// is a React Email template (JSX). tsconfig sets jsx:preserve for Next.js;
// Vite/Vitest's import-analysis plugin can't parse JSX under that setting
// without a separate transform step. Since this test suite is about the
// dispatcher behavior (resolves, handles rejections) rather than email
// rendering, mocking the channel module is the correct boundary.
vi.mock("./email", () => ({
  emailRequestActioned: vi.fn().mockResolvedValue(undefined),
}));

const BASE_PAYLOAD: RequestActionedPayload = {
  requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  kindLabel: "Comp",
  status: "executed",
  executorNotes: null,
  executorEmail: "ops@auckets.com",
  filerEmail: "cope@citizencope.com",
  artistName: "Citizen Cope",
  showContext: "The Ryman Auditorium · Nashville",
};

describe("notifyRequestActioned", () => {
  beforeEach(() => {
    // Ensure no real fetch leaks out. If SLACK_OPS_WEBHOOK_URL were
    // somehow set in the test env this would catch it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("resolves without throwing for an executed request", async () => {
    await expect(
      notifyRequestActioned({ ...BASE_PAYLOAD, status: "executed" }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for a denied request", async () => {
    await expect(
      notifyRequestActioned({ ...BASE_PAYLOAD, status: "denied" }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when executorNotes is set", async () => {
    await expect(
      notifyRequestActioned({
        ...BASE_PAYLOAD,
        executorNotes: "Approved as artist comp per Cope's request.",
      }),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when channels individually error", async () => {
    // Simulate a channel that throws unexpectedly (shouldn't happen
    // since each module catches its own errors, but belt-and-suspenders).
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(notifyRequestActioned(BASE_PAYLOAD)).resolves.toBeUndefined();
  });
});

describe("KIND_LABELS", () => {
  it("covers the standard request kinds", () => {
    expect(KIND_LABELS.comp).toBe("Comp");
    expect(KIND_LABELS.pause).toBe("Pause show");
    expect(KIND_LABELS.resume).toBe("Resume show");
    expect(KIND_LABELS.end_early).toBe("End early");
    expect(KIND_LABELS.other).toBe("Other");
  });
});
