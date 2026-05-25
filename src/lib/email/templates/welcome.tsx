import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

// Placeholder welcome email so the Resend wiring has something to send.
// Real templates land in Week 4 alongside the offer submission flow.
export function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to AUCKETS</Preview>
      <Body
        style={{ backgroundColor: "#ffffff", fontFamily: "system-ui, sans-serif" }}
      >
        <Container style={{ padding: "32px", maxWidth: "560px" }}>
          <Heading style={{ fontSize: "20px", fontWeight: 600 }}>
            Welcome, {name}.
          </Heading>
          <Text style={{ fontSize: "14px", color: "#525252" }}>
            You&apos;re in. We&apos;ll send updates here when shows go live.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WelcomeEmail;
