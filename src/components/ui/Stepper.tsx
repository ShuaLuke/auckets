// Stepper — pill-shaped numeric input with +/- buttons. Matches the
// prototype's Stepper from design/ui_kits/auckets/components/Fields.jsx.
//
// The middle is a real typeable field (not a read-only label): you can set a
// big number directly instead of clicking +/- dozens of times — important for
// "seats per row" (up to 500). The +/- pills remain for quick ±1 nudges.
//
// Editing model: a local `text` string lets the field go briefly empty or
// hold an out-of-range value mid-type. We push the value up live while the
// keystrokes parse to an in-range number, then clamp to [min, max] on blur.
//
// Used for group size (offer composer), max group size, and the new-venue
// tier sizes (ShowCreate). Clamps to [min, max].

"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible label for the field and the step buttons. */
  label?: string;
};

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 8,
  label = "group size",
}: Props) {
  // Mirror of `value` as a string so the field can be empty or hold an
  // out-of-range draft while typing. Re-synced whenever `value` changes from
  // outside (the +/- buttons, a parent reset, the blur-clamp below).
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  // Reconcile the draft to a valid number on blur: empty/garbage falls back
  // to the last committed value; anything else clamps into range.
  const commit = () => {
    const n = Number.parseInt(text, 10);
    const next = Number.isNaN(n) ? value : clamp(n);
    onChange(next);
    setText(String(next));
  };

  return (
    <div
      className="inline-flex items-center self-start overflow-hidden rounded-full bg-[var(--page)]"
      style={{ border: "1px solid var(--border-strong)" }}
    >
      <button
        type="button"
        aria-label={`decrease ${label}`}
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        className="flex h-9 w-9 items-center justify-center bg-transparent transition-colors hover:bg-[var(--paper-2)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--ink-900)" }}
      >
        <Minus size={14} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          setText(raw);
          // Push live only while the draft is an in-range number, so any
          // dependent UI tracks typing; final clamp happens on blur.
          const n = Number.parseInt(raw, 10);
          if (!Number.isNaN(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={commit}
        className="border-0 bg-transparent font-mono text-sm focus:outline-none"
        style={{
          width: 52,
          padding: "0 6px",
          textAlign: "center",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink-900)",
        }}
      />
      <button
        type="button"
        aria-label={`increase ${label}`}
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        className="flex h-9 w-9 items-center justify-center bg-transparent transition-colors hover:bg-[var(--paper-2)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ color: "var(--ink-900)" }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
