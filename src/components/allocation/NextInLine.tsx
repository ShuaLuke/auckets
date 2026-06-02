// NextInLine — the genuine fallback path (State B only). If a closer seat
// opens up, the next fan in line is offered it — at what that seat needs, no
// extra fees. This is the difference between "you lost" and "you're still in
// the running."
//
// IMPORTANT: this card only renders when the route hands us a *real* move-up
// position. The displacement engine (src/lib/allocation/displacement.ts) does
// not yet expose a queue rank, so `moveUpPosition` is null in practice today
// and AllocationResult omits the card — we never invent a number. When the
// displacement/upgrade-offer path surfaces a position, the presenter will set
// it and this card lights up unchanged.
//
// Server component. Reference: the green `.how` variant.

type Props = {
  position: number;
};

export function NextInLine({ position }: Props) {
  return (
    <div
      className="rounded-lg"
      style={{
        background: "var(--brand-bg)",
        border: "1px solid var(--greenwood-100)",
        padding: "18px 20px",
      }}
    >
      <h4
        className="font-sans"
        style={{
          margin: "0 0 8px",
          fontWeight: 600,
          fontSize: "var(--text-sm)",
          color: "var(--brand)",
        }}
      >
        You&apos;re #{position} in line to move up
      </h4>
      <p
        className="font-sans"
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          color: "var(--greenwood-700)",
          lineHeight: 1.6,
        }}
      >
        If a closer seat opens up, we offer it to the next fan in line — at what
        that seat needs, and no fees, ever. We&apos;ll text you; one tap to take
        it or pass.
      </p>
    </div>
  );
}
