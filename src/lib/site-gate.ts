// Site-wide pre-launch password gate.
//
// When SITE_PASSWORD is set, src/middleware.ts redirects every human-facing
// request to /unlock until the visitor presents the shared password. Doing
// so sets a cookie whose value is a *hash* of the password — so the raw
// password is never stored in the cookie, and rotating SITE_PASSWORD
// invalidates every outstanding session for free.
//
// This is a coarse "is the site open to the public yet" gate, NOT per-user
// auth. Clerk still runs behind it; this just decides whether anyone who
// isn't holding the shared password sees anything at all. When SITE_PASSWORD
// is unset the gate is dormant and the site runs wide open (the normal state
// once launched).
//
// Keep this module pure — no env, no next/* imports — so it unit-tests
// without mocking the runtime. The password is always passed in by the
// caller (middleware reads env.SITE_PASSWORD; the unlock action does too).

export const GATE_COOKIE_NAME = "auckets_gate";

// Paths that must stay reachable even while the gate is closed:
//   /unlock              the gate page itself + its server-action POST
//   /api/inngest         Inngest delivers signed background-job calls here;
//                        a machine caller can't type a password
//   /api/stripe/webhook  Stripe posts signed webhook events here
// Each is independently authenticated (Clerk / Inngest request signature /
// Stripe webhook signature), so leaving them open doesn't widen the surface
// — it just keeps background jobs and payment callbacks alive during the
// private preview.
export const GATE_EXEMPT_PREFIXES = [
  "/unlock",
  "/api/inngest",
  "/api/stripe/webhook",
] as const;

// A path is exempt if it equals an exempt prefix or is nested under it
// (`/api/stripe/webhook/...`). The `/`-boundary check is deliberate so a
// lookalike like `/unlocked` is NOT treated as exempt.
export function isGateExemptPath(pathname: string): boolean {
  return GATE_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// SHA-256 hex of the password, via Web Crypto so it runs identically in the
// Edge middleware runtime, the Node server-action runtime, and tests. The
// cookie carries this digest, never the raw password.
export async function gateCookieValue(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Length-constant compare of two hex digests. Mismatched lengths
// short-circuit to false — that only reveals "malformed cookie", which says
// nothing about the password. Avoids the early-exit timing leak of `===`.
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// True when the presented cookie authorizes access for the current password.
// A missing/empty cookie is never valid.
export async function isGateCookieValid(
  cookieValue: string | undefined,
  password: string,
): Promise<boolean> {
  if (!cookieValue) return false;
  return safeEqualHex(cookieValue, await gateCookieValue(password));
}
