// WhyYouLanded — plain-English, defensible to a hostile stranger, never a
// gloat. The single most important paragraph in the product: it has to explain
// *why* this fan landed where they did without a rank number, without "you
// could've paid more", and without inventing a uniform clearing line that the
// pay-as-bid engine doesn't actually charge.
//
// The honest story for the fallback state is the proxy story, not a price war:
// the room was seated by offer, best section first; the closer sections were
// simply worth more to other fans this time; and you pay exactly what you
// offered (or, for an auto-offer, only what your seats needed under your cap),
// never a fee.
//
// Server component. Reference class `.how` (sunken card, h4 + paragraph).

import type { AllocationFinalPlacedView } from "@/lib/presenters";

type Props = {
  view: Pick<
    AllocationFinalPlacedView,
    | "state"
    | "poolCount"
    | "capacity"
    | "size"
    | "capDisplay"
    | "paidPerTicketDisplay"
    | "isAutoUnderCap"
  >;
};

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

export function WhyYouLanded({ view }: Props) {
  const groupClause =
    view.size > 1 ? (
      <>
        {view.state === "in-room"
          ? ", and kept your group of "
          : ", keeping your group of "}
        {view.size} together
      </>
    ) : null;

  return (
    <div
      className="rounded-lg"
      style={{ background: "var(--paper-2)", padding: "18px 20px" }}
    >
      <h4
        className="font-sans"
        style={{ margin: "0 0 8px", fontWeight: 600, fontSize: "var(--text-sm)" }}
      >
        Here&apos;s exactly why you&apos;re here
      </h4>
      <p
        className="font-sans"
        style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--fg-muted)", lineHeight: 1.6 }}
      >
        {view.poolCount.toLocaleString("en-US")} fans said what the night was
        worth to them, for {view.capacity.toLocaleString("en-US")} seats. We
        seated the room by offer, best section first{groupClause}.{" "}
        {view.state === "fallback" && (
          <>
            The closer sections were simply worth more to other fans this time.{" "}
          </>
        )}
        {view.isAutoUnderCap ? (
          <>
            You set a cap of <Mono>{view.capDisplay}</Mono>; we only used what
            your seats needed — <Mono>{view.paidPerTicketDisplay}</Mono> a
            ticket. No fees, ever.
          </>
        ) : (
          <>
            You pay exactly what you offered —{" "}
            <Mono>{view.paidPerTicketDisplay}</Mono> a ticket — and no fees,
            ever.
          </>
        )}
      </p>
    </div>
  );
}
