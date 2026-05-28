import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import { SiteNav } from "@/components/nav/SiteNav";

import "./globals.css";

export const metadata: Metadata = {
  title: "AUCKETS",
  description: "Dynamic ticket allocation marketplace for live music.",
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
