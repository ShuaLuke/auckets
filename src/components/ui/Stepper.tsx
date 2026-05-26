// Stepper — pill-shaped numeric input with +/- buttons. Matches the
// prototype's Stepper from design/ui_kits/auckets/components/Fields.jsx.
//
// Used for group size on the offer composer. Clamps to [min, max].

"use client";

import { Minus, Plus } from "lucide-react";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible label for the step buttons. */
  label?: string;
};

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 8,
  label = "group size",
}: Props) {
  return (
    <div
      className="inline-flex items-center self-start overflow-hidden rounded-full bg-[var(--page)]"
      style={{ border: "1px solid var(--border-strong)" }}
    >
      <button
        type="button"
        aria-label={`decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-9 w-9 items-center justify-center bg-transparent transition-colors hover:bg-[var(--paper-2)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--ink-900)" }}
      >
        <Minus size={14} />
      </button>
      <span
        className="font-mono text-sm"
        style={{
          padding: "0 16px",
          minWidth: 28,
          textAlign: "center",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex h-9 w-9 items-center justify-center bg-transparent transition-colors hover:bg-[var(--paper-2)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--ink-900)" }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
