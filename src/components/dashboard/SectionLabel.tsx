// A section divider on the fan dashboard: an uppercase label, a hairline
// rule that fills the remaining width, and an optional mono count on the
// right ("YOUR OFFERS ──── 2 active"). Server component — pure presentation.
// Part of Change 02: the dashboard groups shows into "Your offers" and
// "On the horizon" instead of one flat list.

type Props = {
  label: string;
  // Optional right-aligned count, e.g. "2 active" / "opens soon".
  count?: string;
};

export function SectionLabel({ label, count }: Props) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-3 first:mt-0">
      <span
        className="font-sans text-[11px] uppercase tracking-[0.12em]"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </span>
      <span
        className="h-px flex-1"
        style={{ background: "var(--border)" }}
        aria-hidden
      />
      {count && (
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "var(--fg-faint)" }}
        >
          {count}
        </span>
      )}
    </div>
  );
}
