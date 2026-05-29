// PLACEHOLDER rotating-token helpers for the TicketViewer.
//
// SECURITY NOTE — this is NOT the production token. The real rotating QR is
// a server-signed TOTP derived from tickets.totp_secret, which per the
// tickets repo PRIVACY note must NEVER reach the client. This module only
// lets the front end render and rotate a QR on the correct 60s cadence
// today. Swapping in the real token is a contained change: fetch it from a
// `GET /api/tickets/[id]/token` endpoint (a backend slice) every window and
// feed the returned string into <TicketViewer> in place of
// buildPlaceholderToken(). The geometry here (window + countdown) is
// reusable as-is; only the token *value* needs to become server-signed.

export const ROTATION_PERIOD_MS = 60_000;

// Which 60s window the given epoch-ms falls in. The scanner-side TOTP uses
// the same windowing so a token is valid for the window it was minted in.
export function rotationWindow(
  nowMs: number,
  periodMs: number = ROTATION_PERIOD_MS,
): number {
  return Math.floor(nowMs / periodMs);
}

// Whole seconds left in the current window, 1..(periodMs/1000). Drives the
// "Rotates in Ns" label and the countdown bar. Counts down to 1 then resets
// at the window boundary (never shows 0).
export function secondsUntilRotation(
  nowMs: number,
  periodMs: number = ROTATION_PERIOD_MS,
): number {
  const msLeft = periodMs - (nowMs % periodMs);
  return Math.max(1, Math.ceil(msLeft / 1000));
}

// A QR payload that changes every window. NOT cryptographic — a scanner
// must treat this as a placeholder until the signed-token endpoint exists.
// Deterministic in (ticketId, window) so re-renders within the same window
// don't flicker the rendered QR.
export function buildPlaceholderToken(ticketId: string, window: number): string {
  return `auckets:ticket:${ticketId}:w${window}`;
}
