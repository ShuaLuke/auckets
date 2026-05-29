import { describe, expect, it } from "vitest";

import {
  generateTicketToken,
  verifyTicketToken,
  WINDOW_MS,
} from "./token";

const TICKET = "44444444-4444-4444-4444-444444444444";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // base32-ish high-entropy seed
// Mid-window so expiresInSeconds lands away from the boundary.
const NOW = 1_700_000_040_000;

describe("generateTicketToken", () => {
  it("produces the auckets.v1.<ticketId>.<window>.<sig> shape", () => {
    const { token } = generateTicketToken(TICKET, SECRET, NOW);
    const parts = token.split(".");
    expect(parts[0]).toBe("auckets");
    expect(parts[1]).toBe("v1");
    expect(parts[2]).toBe(TICKET);
    expect(Number.isInteger(Number(parts[3]))).toBe(true);
    expect(parts[4]).toHaveLength(24);
  });

  it("is deterministic within the same window and differs across windows", () => {
    const a = generateTicketToken(TICKET, SECRET, NOW).token;
    const b = generateTicketToken(TICKET, SECRET, NOW + 999).token; // same window
    const c = generateTicketToken(TICKET, SECRET, NOW + WINDOW_MS).token; // next window
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("reports expiresInSeconds in (0, 60]", () => {
    const { expiresInSeconds } = generateTicketToken(TICKET, SECRET, NOW);
    expect(expiresInSeconds).toBeGreaterThan(0);
    expect(expiresInSeconds).toBeLessThanOrEqual(60);
  });
});

describe("verifyTicketToken", () => {
  it("accepts a freshly minted token (round-trip)", () => {
    const { token } = generateTicketToken(TICKET, SECRET, NOW);
    expect(verifyTicketToken(token, SECRET, NOW)).toEqual({
      ok: true,
      ticketId: TICKET,
      window: Math.floor(NOW / WINDOW_MS),
    });
  });

  it("accepts the previous window (clock-skew tolerance)", () => {
    const prev = generateTicketToken(TICKET, SECRET, NOW - WINDOW_MS).token;
    expect(verifyTicketToken(prev, SECRET, NOW).ok).toBe(true);
  });

  it("rejects a window older than the skew allowance", () => {
    const stale = generateTicketToken(TICKET, SECRET, NOW - 2 * WINDOW_MS).token;
    expect(verifyTicketToken(stale, SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "expired_window",
    });
  });

  it("rejects a future window", () => {
    const future = generateTicketToken(TICKET, SECRET, NOW + WINDOW_MS).token;
    expect(verifyTicketToken(future, SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "expired_window",
    });
  });

  it("rejects a token signed with a different secret (forgery)", () => {
    const { token } = generateTicketToken(TICKET, SECRET, NOW);
    expect(verifyTicketToken(token, "WRONGSECRETWRONGSECRETWRONGSECRET", NOW)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects malformed tokens and unknown versions", () => {
    expect(verifyTicketToken("nonsense", SECRET, NOW).ok).toBe(false);
    expect(verifyTicketToken("auckets.v1.a.b", SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    const { token } = generateTicketToken(TICKET, SECRET, NOW);
    const bumped = token.replace("auckets.v1.", "auckets.v2.");
    expect(verifyTicketToken(bumped, SECRET, NOW)).toMatchObject({
      ok: false,
      reason: "bad_version",
    });
  });
});
