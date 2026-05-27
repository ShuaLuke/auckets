// Ops notification email sent when AUCKETS staff execute or deny an
// artist request. Intentionally plain - this is an internal ops
// communication, not a fan-facing template. Adapts to both "executed"
// and "denied" so a single template covers the two cases from
// PATCH /api/artist-requests/[id].
//
// Props are raw strings (no DB types) so this template can be
// imported from the notifications module without coupling it to the
// repositories layer.

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export type RequestActionedEmailProps = {
  // Human-readable label for the request kind (e.g. "Comp", "Pause show").
  kindLabel: string;
  status: "executed" | "denied";
  executorEmail: string;
  filerEmail: string;
  artistName: string;
  // E.g. "The Ryman Auditorium - Nashville" -- venue name + city.
  showContext: string;
  executorNotes: string | null;
};

export function RequestActionedEmail({
  kindLabel,
  status,
  executorEmail,
  filerEmail,
  artistName,
  showContext,
  executorNotes,
}: RequestActionedEmailProps) {
  const statusLabel = status === "executed" ? "Executed" : "Denied";
  const statusColor = status === "executed" ? "#166534" : "#991b1b";
  const previewText = statusLabel + ": " + kindLabel + " - " + artistName;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body
        style={{ backgroundColor: "#f9fafb", fontFamily: "system-ui, sans-serif" }}
      >
        <Container
          style={{
            padding: "32px",
            maxWidth: "560px",
            margin: "32px auto",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
        >
          <Text
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: statusColor,
              margin: "0 0 4px",
            }}
          >
            {statusLabel}
          </Text>
          <Text
            style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 24px" }}
          >
            {kindLabel} request
          </Text>

          <Hr style={{ borderColor: "#e5e7eb", margin: "0 0 16px" }} />

          <Text style={{ fontSize: "13px", color: "#374151", margin: "0 0 8px" }}>
            <strong>Artist:</strong> {artistName}
          </Text>
          <Text style={{ fontSize: "13px", color: "#374151", margin: "0 0 8px" }}>
            <strong>Show:</strong> {showContext}
          </Text>
          <Text style={{ fontSize: "13px", color: "#374151", margin: "0 0 8px" }}>
            <strong>Filed by:</strong> {filerEmail}
          </Text>
          <Text style={{ fontSize: "13px", color: "#374151", margin: "0 0 8px" }}>
            <strong>Actioned by:</strong> {executorEmail}
          </Text>

          {executorNotes ? (
            <>
              <Hr style={{ borderColor: "#e5e7eb", margin: "16px 0" }} />
              <Text
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#9ca3af",
                  margin: "0 0 4px",
                }}
              >
                Notes
              </Text>
              <Text style={{ fontSize: "13px", color: "#374151", margin: 0 }}>
                {executorNotes}
              </Text>
            </>
          ) : null}

          <Hr style={{ borderColor: "#e5e7eb", margin: "24px 0 16px" }} />
          <Text style={{ fontSize: "11px", color: "#9ca3af", margin: 0 }}>
            AUCKETS ops notification - do not reply to this address.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default RequestActionedEmail;
