// ResultRecap — where the "money beat me" feeling is defused, honestly. The
// product is pay-as-bid: each fan pays what their own offer settled at, never
// a uniform clearing line. So a flat offer shows the simplest possible truth —
// you offered $X, you pay $X, $0 in fees, ever. An auto-offer that settled
// below its cap shows the one honest saving: you set a cap, we only used what
// your seats needed. We render the real charged amount the route handed us;
// nothing here re-derives money.
//
// Server component. Reference class `.recap` (rows of label/value, hairline-
// separated, in a bordered rounded box) + the green `.save-chip`.

import type { AllocationFinalPlacedView } from "@/lib/presenters";

type Props = {
  view: Pick<
    AllocationFinalPlacedView,
    | "size"
    | "capDisplay"
    | "paidPerTicketDisplay"
    | "chargedTotalDisplay"
    | "isAutoUnderCap"
    | "underCapDisplay"
  >;
};

export function ResultRecap({ view }: Props) {
  return (
    <div className="flex flex-col gap-[26px]">
      <div
        className="flex flex-col overflow-hidden rounded-lg"
        style={{ gap: 1, background: "var(--border)", border: "1px solid var(--border)" }}
      >
        {view.isAutoUnderCap ? (
          <>
            <Row label="You offered up to" value={view.capDisplay} />
            <Row label="Auto-offer settled at" value={view.paidPerTicketDisplay} />
          </>
        ) : (
          <Row label="You offered" value={view.capDisplay} />
        )}
        <Row label={`You pay  × ${view.size}`} value={view.chargedTotalDisplay} big />
        <Row label="No fees, ever" value="$0.00" />
      </div>

      {view.isAutoUnderCap && view.underCapDisplay && (
        <span
          className="inline-flex items-center gap-[7px] self-start font-mono"
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 999,
            background: "var(--greenwood-50)",
            color: "var(--greenwood-700)",
          }}
        >
          ↓ {view.underCapDisplay} under your cap — we only ever use what your
          seats need
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  big = false,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ background: "var(--page)", padding: "13px 16px" }}
    >
      <span className="font-sans" style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: big ? "var(--text-xl)" : "var(--text-md)",
          color: big ? "var(--brand)" : "var(--fg)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
