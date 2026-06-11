// Shared chrome for fan-facing emails (wordmark header, card container,
// footer). The fan templates — including the welcome — fill in the body +
// CTA. The ops template (RequestActioned) stays plainer and off-shell.
//
// Props are presentation-only — callers pass pre-formatted strings, so this
// module never imports DB types or the repositories layer.

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export function FanEmailShell({
  preview,
  footerNote,
  children,
}: {
  preview: string;
  // Why-you're-getting-this line in the footer. The default fits the show
  // lifecycle emails; the welcome (no show activity yet) passes its own.
  footerNote?: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{ backgroundColor: "#f5f3ec", fontFamily: "system-ui, sans-serif" }}
      >
        <Container
          style={{
            padding: "32px",
            maxWidth: "560px",
            margin: "32px auto",
            backgroundColor: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #e5e1d6",
          }}
        >
          <Text
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#0e0f0c",
              margin: "0 0 24px",
            }}
          >
            AUCKETS
          </Text>
          {children}
          <Hr style={{ borderColor: "#e5e1d6", margin: "28px 0 16px" }} />
          <Text style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>
            {footerNote ??
              "AUCKETS — not an auction. You're receiving this because you have activity on a show. Please don't reply to this address."}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// Section heading used at the top of each fan email body.
export function FanHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      style={{
        fontSize: "22px",
        fontWeight: 600,
        color: "#0e0f0c",
        margin: "0 0 12px",
      }}
    >
      {children}
    </Heading>
  );
}

// Standard body paragraph.
export function FanText({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{ fontSize: "14px", lineHeight: "1.55", color: "#374151", margin: "0 0 14px" }}
    >
      {children}
    </Text>
  );
}

// Primary call-to-action button.
export function FanCta({ href, label }: { href: string; label: string }) {
  return (
    <Button
      href={href}
      style={{
        display: "inline-block",
        backgroundColor: "#1f4a2e",
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: 600,
        padding: "11px 20px",
        borderRadius: "8px",
        textDecoration: "none",
        margin: "6px 0 4px",
      }}
    >
      {label}
    </Button>
  );
}

// Compact "show identity" line: artist + venue + date.
export function ShowSummaryLine({
  artistName,
  showName,
  dateLong,
}: {
  artistName: string;
  showName: string;
  dateLong: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#f5f3ec",
        borderRadius: "8px",
        padding: "14px 16px",
        margin: "0 0 18px",
      }}
    >
      <Text style={{ fontSize: "15px", fontWeight: 600, color: "#0e0f0c", margin: "0 0 2px" }}>
        {showName}
      </Text>
      <Text style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
        {artistName} · {dateLong}
      </Text>
    </div>
  );
}
