// Post-binding fan result — prototype-fidelity port of
// design/ui_kits/auckets/screens/AllocationFinal.jsx. Pure presentation over
// the AllocationFinalView the route builds; no client interactivity beyond the
// CTA links, so this stays a server component.
//
// Three outcomes (the view's discriminated `kind`): placed (the "you're in"
// ticket stub + what's-next), card_failure (seat held, recovery on the Show
// page), and unplaced (auth released, no charge).

import { DoorOpen, Mail, QrCode } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { AllocationFinalView } from "@/lib/presenters";

type Props = { view: AllocationFinalView };

// Anchor styled as a pill button. The shared Button is a <button>; CTAs here
// navigate, so we style a <Link> directly rather than nest a button in an
// anchor.
function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const style =
    variant === "primary"
      ? { background: "var(--ink-900)", color: "var(--paper)" }
      : { background: "transparent", color: "var(--ink-900)" };
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-transparent px-[18px] py-2 font-sans text-sm font-medium leading-none transition-colors duration-150"
      style={{ ...style, letterSpacing: "-0.01em" }}
    >
      {children}
    </Link>
  );
}

function SeatBlock({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span
        className="font-sans uppercase"
        style={{ fontSize: 11, color: "#6B6759", letterSpacing: "0.1em" }}
      >
        {label}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 20,
          color: accent ? "#1F4A2E" : "#0E0F0C",
          fontVariantNumeric: "tabular-nums",
          fontWeight: accent ? 600 : 400,
        }}
      >
        {value}
      </span>
      <span className="font-sans" style={{ fontSize: 12, color: "#46443B" }}>
        {sub}
      </span>
    </div>
  );
}

export function AllocationResult({ view }: Props) {
  const isPlaced = view.kind === "placed";

  return (
    <main className="min-h-[calc(100vh-57px)]" style={{ background: "var(--paper)" }}>
      <div className="mx-auto px-4 py-16 md:px-8" style={{ maxWidth: 760 }}>
        <Eyebrow style={{ marginBottom: 14 }}>Allocation complete</Eyebrow>
        <h1
          className="font-display"
          style={{
            fontSize: 56,
            lineHeight: 1.0,
            letterSpacing: "-0.035em",
            marginBottom: 16,
            fontWeight: 700,
          }}
        >
          {isPlaced ? "You're in." : view.kind === "card_failure" ? "One more step." : "You're not placed."}
        </h1>
        <p
          className="font-sans"
          style={{ fontSize: 16, lineHeight: 1.55, color: "#2C2B25", marginBottom: 32, maxWidth: 540 }}
        >
          {view.kind === "placed" && (
            <>
              Binding allocation ran. Your group has{" "}
              <strong>{view.size} seats</strong> in {view.tierLabel}. We&apos;ve
              charged{" "}
              <span className="font-mono">{view.chargedTotal}</span> to your
              card.
            </>
          )}
          {view.kind === "card_failure" && (
            <>
              Your group placed in {view.venue}, but the{" "}
              <span className="font-mono">{view.amountDue}</span> charge
              didn&apos;t go through. Your seats are held for a short window —
              update your card on the show page to keep them.
            </>
          )}
          {view.kind === "unplaced" && (
            <>
              Your offer wasn&apos;t ranked high enough to clear the venue. Your
              authorization has been released — <strong>no charge</strong>.
            </>
          )}
        </p>

        {view.kind === "placed" ? (
          <div
            className="relative mb-7 rounded-xl bg-white p-7"
            style={{ border: "1px solid #0E0F0C", boxShadow: "6px 6px 0 0 #1F4A2E" }}
          >
            {/* Ticket-stub punches */}
            <span
              className="absolute rounded-full"
              style={{ left: -8, top: "50%", width: 16, height: 16, background: "var(--paper)", border: "1px solid #0E0F0C" }}
              aria-hidden
            />
            <span
              className="absolute rounded-full"
              style={{ right: -8, top: "50%", width: 16, height: 16, background: "var(--paper)", border: "1px solid #0E0F0C" }}
              aria-hidden
            />

            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow style={{ marginBottom: 8 }}>{view.artist}</Eyebrow>
                <div
                  className="font-display"
                  style={{ fontWeight: 700, fontSize: 32, lineHeight: 1.05, letterSpacing: "-0.03em" }}
                >
                  {view.venue}
                </div>
                <div className="font-sans" style={{ fontSize: 14, color: "#46443B", marginTop: 4 }}>
                  {view.dateLong}
                  {view.city ? ` · ${view.city}` : ""}
                </div>
              </div>
              <Badge tone="placed">Placed · binding</Badge>
            </div>

            <div style={{ borderTop: "1px dashed #0E0F0C", margin: "22px 0" }} />

            <div className="grid grid-cols-2 gap-4">
              <SeatBlock
                label="Section"
                value={view.tierLabel}
                sub={view.rowName ? `Row ${view.rowName}` : "—"}
              />
              <SeatBlock
                label="Seats"
                value={view.seats}
                sub={`${view.size} together`}
              />
              <SeatBlock label="Price" value={view.pricePerTicket} sub="per ticket" />
              <SeatBlock label="Charged" value={view.chargedTotal} sub="to your card" accent />
            </div>

            <div style={{ borderTop: "1px dashed #0E0F0C", margin: "22px 0" }} />

            <div className="flex items-center justify-between">
              <span className="font-mono" style={{ fontSize: 11, color: "#46443B" }}>
                {view.ticketReady ? "Ticket issued" : "Ticket pending"}
              </span>
              <Badge tone={view.ticketReady ? "placed" : "preview"} dot={false}>
                {view.ticketReady ? "QR ready" : "QR at T-48h"}
              </Badge>
            </div>
          </div>
        ) : (
          <div
            className="mb-7 rounded-xl bg-white p-7"
            style={{ border: "1px solid rgba(14,15,12,.12)" }}
          >
            <div className="mb-[22px] flex items-start justify-between gap-4">
              <div>
                <Eyebrow style={{ marginBottom: 8 }}>{view.artist}</Eyebrow>
                <div
                  className="font-display"
                  style={{ fontWeight: 700, fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.025em" }}
                >
                  {view.venue}
                </div>
                <div className="font-sans" style={{ fontSize: 14, color: "#46443B", marginTop: 4 }}>
                  {view.dateLong}
                  {view.city ? ` · ${view.city}` : ""}
                </div>
              </div>
              <Badge tone={view.kind === "card_failure" ? "unplaced" : "unplaced"}>
                {view.kind === "card_failure" ? "Card declined" : "Unplaced"}
              </Badge>
            </div>

            {view.kind === "unplaced" ? (
              <div className="grid grid-cols-2 gap-[14px]">
                <SeatBlock
                  label="Your offer"
                  value={view.offerPrice}
                  sub={`× ${view.size} tickets`}
                />
                <SeatBlock label="Released" value="$0.00" sub="to your card" accent />
              </div>
            ) : (
              <div
                className="rounded-lg p-3 font-sans"
                style={{ background: "#F6E6CC", color: "#8F6A2A", fontSize: 13, lineHeight: 1.5 }}
              >
                Head to the show page and update your card within the recovery
                window to keep your {view.size} seats — we&apos;ll charge{" "}
                {view.amountDue}.
              </div>
            )}
          </div>
        )}

        {view.kind === "placed" && (
          <Card variant="warm" style={{ padding: 22, marginBottom: 24 }}>
            <Eyebrow style={{ marginBottom: 12 }}>What&apos;s next</Eyebrow>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              <li className="flex items-center gap-3">
                <Mail size={16} color="#1F4A2E" aria-hidden />
                <span className="font-sans" style={{ fontSize: 14, color: "#1C1B17" }}>
                  A confirmation receipt is on its way to your inbox.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <QrCode size={16} color="#1F4A2E" aria-hidden />
                <span className="font-sans" style={{ fontSize: 14, color: "#1C1B17" }}>
                  {view.ticketReady
                    ? "Your QR ticket is ready — open it below."
                    : "A QR ticket appears 48 hours before doors, here and on the app."}
                </span>
              </li>
              <li className="flex items-center gap-3">
                <DoorOpen size={16} color="#1F4A2E" aria-hidden />
                <span className="font-sans" style={{ fontSize: 14, color: "#1C1B17" }}>
                  Bring an ID matching the name on the offer. Doors {view.dateLong}.
                </span>
              </li>
            </ol>
          </Card>
        )}

        <div className="flex flex-wrap gap-3">
          <LinkButton href="/dashboard">Back to my shows</LinkButton>
          {view.kind === "placed" && view.ticketReady && (
            <LinkButton href={`/tickets/${view.showId}`} variant="ghost">
              View ticket
            </LinkButton>
          )}
          {view.kind === "card_failure" && (
            <LinkButton href={`/shows/${view.showId}`} variant="ghost">
              Update card
            </LinkButton>
          )}
          {view.kind === "unplaced" && (
            <LinkButton href="/" variant="ghost">
              See other shows
            </LinkButton>
          )}
        </div>
      </div>
    </main>
  );
}
