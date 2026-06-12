// Serves /robots.txt. Until this existed, every crawler's conventional
// probe fell through to the 404 page — a full middleware + Clerk + render
// pass logged as an error in production for each hit.
//
// Only the discovery surfaces are crawlable. Everything behind auth
// (dashboards, offers, tickets, admin, the door scanner) is disallowed —
// crawlers would only ever see the sign-in redirect anyway.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/dashboard",
        "/offers",
        "/tickets/",
        "/allocation/",
        "/artists",
        "/scan",
      ],
    },
  };
}
