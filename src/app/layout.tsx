import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";

import { SiteNav } from "@/components/nav/SiteNav";

import "./globals.css";

export const metadata: Metadata = {
  title: "AUCKETS",
  description: "Dynamic ticket allocation marketplace for live music.",
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
    >
      <html lang="en">
        <body className="antialiased">
          <SiteNav />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
