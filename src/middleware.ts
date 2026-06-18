import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  GATE_COOKIE_NAME,
  isGateCookieValid,
  isGateExemptPath,
} from "@/lib/site-gate";

// Routes that require an authenticated user. Anything not listed here is
// public; per docs/SECURITY.md #1 the absence of an entry is deliberate —
// every route that touches the database will gate itself with `auth()` at
// the handler level too. The middleware is the first line of defense.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  // Pre-launch site-wide password gate. Active only when SITE_PASSWORD is
  // set (dormant in local/dev/CI and post-launch, so nothing changes there).
  // It runs BEFORE Clerk so the marketing landing and sign-in are gated too
  // — Cope wants the whole site behind one shared password during the
  // private preview. See src/lib/site-gate.ts.
  const sitePassword = env.SITE_PASSWORD;
  if (sitePassword) {
    const { pathname } = req.nextUrl;
    if (!isGateExemptPath(pathname)) {
      const cookie = req.cookies.get(GATE_COOKIE_NAME)?.value;
      if (!(await isGateCookieValid(cookie, sitePassword))) {
        // API callers can't render the unlock page, so hand them a clean
        // 401 instead of an HTML redirect. (In practice they shouldn't
        // reach here pre-unlock — there are no app pages to fire XHRs from
        // until the cookie is set — but this keeps fetches honest.)
        if (pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "site_locked" }, { status: 401 });
        }
        // Browser navigation → send it to /unlock, remembering where the
        // visitor was headed so we can return them there after they unlock.
        const url = req.nextUrl.clone();
        url.pathname = "/unlock";
        url.search = "";
        const next = `${pathname}${req.nextUrl.search}`;
        if (next !== "/") url.searchParams.set("next", next);
        return NextResponse.redirect(url);
      }
    }
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless their query string
    // requires going through middleware (e.g. for search params).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run middleware for API and tRPC routes.
    "/(api|trpc)(.*)",
  ],
};
