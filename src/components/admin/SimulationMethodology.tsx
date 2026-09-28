// "How it works" for an allocation policy: the base method every policy
// shares, then what this policy changes, then what it costs — as numbered
// sentences behind a disclosure, so the picker stays short and anyone can
// expand a policy and read exactly what it will do.

import { BASE_METHOD, methodologyFor, type Methodology } from "@/lib/sim/methodology";

const muted: React.CSSProperties = { color: "var(--fg-muted)" };

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 font-sans text-[12px] leading-relaxed" style={muted}>
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

// The shared method, once, above the policy list.
export function BaseMethodology() {
  return (
    <details className="group">
      <summary className="cursor-pointer font-sans text-[12px] underline underline-offset-2" style={muted}>
        {BASE_METHOD.title} — how the engine seats a crowd
      </summary>
      <div className="mt-2 pl-1">
        <Steps steps={BASE_METHOD.steps} />
      </div>
    </details>
  );
}

// One policy's changes to the base method. `name` is the policy as run,
// e.g. "clean-fit+singles-reserve"; combined policies list each part.
export function PolicyMethodology({ name, open = false }: { name: string; open?: boolean }) {
  let m: Methodology;
  try {
    m = methodologyFor(name);
  } catch {
    return null;
  }
  return (
    <details open={open}>
      <summary className="cursor-pointer font-sans text-[11px] underline underline-offset-2" style={muted}>
        How it works
      </summary>
      <div className="mt-1.5 flex flex-col gap-3 pl-1">
        <div className="font-sans text-[11px]" style={{ color: m.rankFirst ? "var(--fg-subtle)" : "#8a5a1f" }}>
          {m.rankFirst ? "Rank-first: the queue order is what decides, and anyone passed over was passed over only so a seat wouldn't go empty — the report counts each one." : "Fill-first: some fans are held back on purpose so more seats fill. The report counts every one and how far they moved."}
        </div>
        {m.parts.map((p) => (
          <div key={p.key}>
            {m.parts.length > 1 && (
              <div className="mb-1 font-sans text-[12px] font-semibold" style={{ color: "var(--fg)" }}>
                {p.label}
              </div>
            )}
            <Steps steps={p.steps} />
            <p className="mt-1.5 font-sans text-[12px] leading-relaxed" style={muted}>
              <span className="font-semibold" style={{ color: "var(--fg)" }}>
                What it costs:
              </span>{" "}
              {p.tradeoff}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}
