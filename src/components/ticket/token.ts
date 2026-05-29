// Client-side rotation *timing* helpers for the TicketViewer.
//
// These compute only the 60s window cadence — which window we're in and how
// long until it rolls over. The token VALUE itself is server-signed and
// fetched from GET /api/tickets/[id]/token (src/lib/tickets/token.ts); the
// browser never mints it. The component refetches when rotationWindow()
// changes and uses secondsUntilRotation() for the "rotates in Ns" label and
// the countdown bar. This windowing must match the server's WINDOW_MS so the
// client refetches exactly when the server's token changes.

export const ROTATION_PERIOD_MS = 60_000;

// Which 60s window the given epoch-ms falls in. Mirrors windowFor() on the
// server so the client refetches at the same boundary the token changes.
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
