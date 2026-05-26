// RadioGroup — stacked, full-width options with label + hint each.
// Matches the prototype's RadioGroup from
// design/ui_kits/auckets/components/Fields.jsx.
//
// Selected option gets an ink-900 border + paper-50 background; the
// underlying native radio is kept (with `accent-color: greenwood`) for
// keyboard / screen-reader correctness.

"use client";

import { type ReactNode } from "react";

export type RadioOption<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  hint?: ReactNode;
};

type Props<TValue extends string> = {
  name: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: ReadonlyArray<RadioOption<TValue>>;
};

export function RadioGroup<TValue extends string>({
  name,
  value,
  onChange,
  options,
}: Props<TValue>) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg transition-colors duration-150"
            style={{
              padding: "10px 12px",
              border: `1px solid ${selected ? "var(--ink-900)" : "var(--border)"}`,
              background: selected ? "var(--ink-50)" : "var(--page)",
            }}
          >
            <input
              type="radio"
              name={name}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="mt-[3px]"
              style={{ accentColor: "var(--brand)" }}
            />
            <div className="flex flex-col gap-0.5">
              <span
                className="font-sans text-[13px] font-medium"
                style={{ color: "var(--ink-900)" }}
              >
                {opt.label}
              </span>
              {opt.hint && (
                <span
                  className="font-sans text-xs"
                  style={{ color: "var(--fg-subtle)" }}
                >
                  {opt.hint}
                </span>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
