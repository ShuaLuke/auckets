// AdminHealthStrip — Change 05.3. The live health-at-a-glance band the
// command center needs before a real show runs (Go-Live §5). Dense, mono,
// calm; red only on a real problem (a card that failed to capture).
//
// Only metrics with a real data source appear: offers live, provisional fill,
// capture health, and the next binding run. Email/SMS send rates and a
// generic app-error count have no backing table yet and are deliberately
// omitted rather than faked (flagged in the PR). Server component, tokens only.

import type { AdminHealthView } from "@/lib/presenters";

type Props = { health: AdminHealthView };

export function AdminHealthStrip({ health }: Props) {
  return (
    <div
      className="grid grid-cols-2 overflow-hidden rounded-xl border md:grid-cols-4"
      style={{ borderColor: "var(--border)", background: "var(--page)" }}
    >
      <Cell label="Offers live">
        <Value>{health.offersLive.toLocaleString("en-US")}</Value>
        <Sub>for {health.ticketsLive.toLocaleString("en-US")} tickets</Sub>
      </Cell>

      <Cell label="Seats placed">
        <Value>
          {health.seatsPlaced.toLocaleString("en-US")}{" "}
          <span style={{ color: "var(--fg-faint)" }}>
            / {health.seatsCapacity.toLocaleString("en-US")}
          </span>
        </Value>
        <Sub>{health.seatsPct}% provisional fill</Sub>
      </Cell>

      <Cell label="Capture health">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: health.captureOk
                ? "var(--greenwood-600)"
                : "var(--brick-500)",
            }}
            aria-hidden
          />
          <span
            className="font-sans text-sm"
            style={{
              color: health.captureOk ? "var(--fg)" : "var(--brick-700)",
              fontWeight: 600,
            }}
          >
            {health.captureLabel}
          </span>
        </div>
        <Sub>{health.charged.toLocaleString("en-US")} charged so far</Sub>
      </Cell>

      <Cell label="Next binding run" last>
        {health.nextBinding ? (
          <>
            <Value>{health.nextBinding.countdown}</Value>
            <Sub>{health.nextBinding.venue}</Sub>
          </>
        ) : (
          <>
            <Value>—</Value>
            <Sub>none scheduled</Sub>
          </>
        )}
      </Cell>
    </div>
  );
}

function Cell({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 p-4"
      style={
        last ? undefined : { borderRight: "1px solid var(--border)" }
      }
    >
      <span
        className="font-sans text-[10px] uppercase tracking-[0.12em]"
        style={{ color: "var(--fg-subtle)" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono text-xl tabular-nums"
      style={{ color: "var(--fg)" }}
    >
      {children}
    </span>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-xs" style={{ color: "var(--fg-muted)" }}>
      {children}
    </span>
  );
}
