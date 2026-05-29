// Server-only rotating-ticket-token helpers (ADR-0015).
//
// The fan's QR must (a) change every 60s so a screenshot is worthless after a
// minute, (b) be unforgeable without the ticket's server-only secret, and
// (c) be checkable by the door scanner. We use an HMAC-signed, time-windowed
// token rather than a bare numeric TOTP so the payload self-identifies the
// ticket and carries its own validity window:
//
//   auckets.v1.<ticketId>.<window>.<sig>
//
// where window = floor(epoch_ms / 60_000) and
//   sig = base64url(HMAC-SHA256(secret, "<ticketId>.<window>")) truncated.
//
// The secret is tickets.totp_secret — a high-entropy per-ticket string that
// NEVER leaves the server (read only via getTicketSecretForRotatingQr). The
// scanner slice will validate by recomputing the signature for the current
// window (and the previous one, for clock skew) with verifyTicketToken().
//
// SERVER ONLY: imports node:crypto and handles the secret. Never import this
// into a client component — the browser fetches the token from the
// GET /api/tickets/[ticketId]/token endpoint instead.

import { createHmac, timingSafeEqual } from "node:crypto";

export const TOKEN_VERSION = "v1";
export const WINDOW_MS = 60_000;
// 24 base64url chars ≈ 18 bytes of HMAC — far beyond brute-forceable within a
// 60s window for an online, single-use door scan.
const SIG_CHARS = 24;
// Scanner tolerance: accept the current window and the previous one so a QR
// rendered just before a boundary still scans a few seconds later.
const DEFAULT_SKEW_WINDOWS = 1;

export type TicketTokenResult = {
  token: string;
  // Whole seconds until this token's window rolls over (1..60). The client
  // refetches at or before this mark.
  expiresInSeconds: number;
};

export type VerifyResult =
  | { ok: true; ticketId: string; window: number }
  | {
      ok: false;
      reason: "malformed" | "bad_version" | "expired_window" | "bad_signature";
    };

export function windowFor(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS);
}

function secondsLeftInWindow(nowMs: number): number {
  const msLeft = WINDOW_MS - (nowMs % WINDOW_MS);
  return Math.max(1, Math.ceil(msLeft / 1000));
}

function sign(secret: string, ticketId: string, window: number): string {
  return createHmac("sha256", secret)
    .update(`${ticketId}.${window}`)
    .digest("base64url")
    .slice(0, SIG_CHARS);
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; check first (length isn't
  // secret here — the signature length is fixed by SIG_CHARS).
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Mint the token a fan's QR should currently encode. `nowMs` is injectable
// for deterministic tests.
export function generateTicketToken(
  ticketId: string,
  secret: string,
  nowMs: number = Date.now(),
): TicketTokenResult {
  const window = windowFor(nowMs);
  const sig = sign(secret, ticketId, window);
  return {
    token: `auckets.${TOKEN_VERSION}.${ticketId}.${window}.${sig}`,
    expiresInSeconds: secondsLeftInWindow(nowMs),
  };
}

// Validate a scanned token against the ticket's secret. The scanner slice
// calls this; included here so generation and verification live together and
// are round-trip tested. Accepts the current window and up to `skewWindows`
// earlier ones.
export function verifyTicketToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
  skewWindows: number = DEFAULT_SKEW_WINDOWS,
): VerifyResult {
  const parts = token.split(".");
  // ticketId (uuid) and sig (base64url) never contain ".", so exactly 5 parts.
  if (parts.length !== 5 || parts[0] !== "auckets") {
    return { ok: false, reason: "malformed" };
  }
  // Length-checked above, so the tuple is fully populated — assert it so
  // noUncheckedIndexedAccess doesn't widen each element to string|undefined.
  const [, version, ticketId, windowStr, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== TOKEN_VERSION) return { ok: false, reason: "bad_version" };

  const window = Number(windowStr);
  if (!Number.isInteger(window)) return { ok: false, reason: "malformed" };

  const current = windowFor(nowMs);
  // Reject future windows and anything older than the skew allowance.
  if (window > current || window < current - skewWindows) {
    return { ok: false, reason: "expired_window" };
  }

  if (!constantTimeEquals(sig, sign(secret, ticketId, window))) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, ticketId, window };
}
