import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes that require an authenticated user. Anything not listed here is
// public; per docs/SECURITY.md #1 the absence of an entry is deliberate —
// every route that touches the database will gate itself with `auth()` at
// the handler level too. The middleware is the first line of defense.
const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
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
