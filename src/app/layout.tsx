import { ClerkProvider } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";

import { SiteNav } from "@/components/nav/SiteNav";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { env } from "@/lib/env";

import "./globals.css";

// Brand faces, self-hosted via next/font (was a render-blocking Google
// Fonts @import in design-system.css, which FOUT'd the display face on
// every cold load). The `variable` bindings define CSS custom properties
// on <html> that design-system.css folds into --font-display /
// --font-sans / --font-mono.
//
// Geist isn't in Next 14.2's bundled Google Fonts manifest, so it comes
// from Vercel's `geist` package instead (same next/font machinery; its
// variable name --font-geist-sans is fixed by the package).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  // Keep the optical-size axis — design-system.css sets
  // font-variation-settings: "opsz" per display size for poster-tight
  // headlines. (wght is included by default for variable fonts.)
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const TAGLINE = "AUCKETS — Front row, fair price";
const DESCRIPTION =
  "Fans name their price for the show. The engine seats the room fairly — no auctions, no countdowns, no scalpers.";

export const metadata: Metadata = {
  // Canonical host, so OG/twitter image URLs resolve absolutely in
  // shared links. (Next would otherwise fall back to the deployment URL.)
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: TAGLINE,
    template: "%s · AUCKETS",
  },
  description: DESCRIPTION,
  openGraph: {
    title: TAGLINE,
    description: DESCRIPTION,
    siteName: "AUCKETS",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TAGLINE,
    description: DESCRIPTION,
  },
};

// Explicit viewport (Next injects a width=device-width default, but we
// state it so the mobile contract is visible and intentional). No
// maximum-scale / user-scalable lock — pinch-zoom stays available for
// accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      appearance={clerkAppearance}
    >
      <html
        lang="en"
        className={`${bricolage.variable} ${GeistSans.variable} ${jetbrainsMono.variable}`}
      >
        <body className="antialiased">
          <SiteNav />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
