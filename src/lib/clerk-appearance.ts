// Clerk appearance — themes the hosted auth components (<SignIn />,
// <SignUp />, <UserButton /> …) to the AUCKETS design system so the
// sign-in surface stops looking like a default SaaS widget.
//
// Two layers, per Clerk's appearance API:
//   variables — the broad palette/typography knobs Clerk derives its
//               internal shades from.
//   elements  — targeted style objects for the few pieces the variables
//               can't reach (pill buttons, display-face heading, brand
//               focus ring).
//
// Values are literal hex where Clerk computes derived shades from them
// (it can't resolve var() at derive time), and CSS custom properties
// where the style is applied verbatim. Hex literals mirror
// src/app/design-system.css — keep them in sync if the palette moves.
//
// NOTE: the "Sign in to My Application" headline text comes from the
// Clerk dashboard's application name, not from code. Renaming it to
// AUCKETS is an ops task in the Clerk dashboard.

import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type ClerkAppearance = NonNullable<
  ComponentProps<typeof ClerkProvider>["appearance"]
>;

export const clerkAppearance: ClerkAppearance = {
  variables: {
    // Palette (design-system.css)
    colorPrimary: "#1F4A2E", // --greenwood-600
    colorText: "#0E0F0C", // --ink-900
    colorTextSecondary: "#46443B", // --ink-500
    colorBackground: "#FFFFFF", // --bg-elevated (card sits on paper page)
    colorInputBackground: "#FFFFFF",
    colorInputText: "#0E0F0C",
    colorNeutral: "#0E0F0C",
    colorDanger: "#A93C2A", // --brick-500
    colorSuccess: "#1F4A2E",
    colorWarning: "#C99A4B", // --marquee-500

    // Type — the next/font variables defined on <html> in layout.tsx.
    fontFamily: "var(--font-sans)",
    fontFamilyButtons: "var(--font-sans)",

    // Cards/inputs sit at --radius-lg; buttons go full pill via elements.
    borderRadius: "12px",
  },
  elements: {
    card: {
      backgroundColor: "var(--bg-elevated)",
      boxShadow: "var(--shadow-md)",
    },
    headerTitle: {
      fontFamily: "var(--font-display)",
      fontWeight: 600,
      letterSpacing: "var(--tr-tighter)",
    },
    // Pill buttons, matching the Button primitive (rounded-full).
    formButtonPrimary: {
      borderRadius: "var(--radius-pill)",
      background: "var(--brand)",
      color: "var(--brand-fg)",
      fontWeight: 500,
      letterSpacing: "-0.01em",
      textTransform: "none",
      boxShadow: "none",
      border: "1px solid transparent",
      "&:hover": { background: "var(--brand-hover)" },
      "&:focus": { background: "var(--brand-hover)" },
    },
    socialButtonsBlockButton: {
      borderRadius: "var(--radius-pill)",
    },
    // Brand focus ring on inputs (greenwood, soft halo).
    formFieldInput: {
      "&:focus": {
        borderColor: "var(--brand)",
        boxShadow: "0 0 0 3px var(--greenwood-100)",
      },
    },
    footerActionLink: {
      color: "var(--brand)",
      "&:hover": { color: "var(--brand-hover)" },
    },
  },
};
