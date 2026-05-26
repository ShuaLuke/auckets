// Field — label + control + optional hint. Matches the prototype's
// Field from design/ui_kits/auckets/components/Fields.jsx.
//
// Wraps form controls (TextInput, Stepper, RadioGroup) with the
// consistent label-on-top + hint-below pattern.

import { type ReactNode } from "react";

type Props = {
  label?: string;
  hint?: string;
  children: ReactNode;
  // Use to associate the label with a single control via htmlFor.
  // When the control is composite (RadioGroup, Stepper) leave it
  // unset — the label is decorative, not for click-targeting.
  htmlFor?: string;
};

export function Field({ label, hint, children, htmlFor }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={htmlFor}
          className="font-sans text-xs font-medium"
          style={{ color: "var(--fg-subtle)" }}
        >
          {label}
        </label>
      )}
      {children}
      {hint && (
        <div
          className="font-sans text-xs"
          style={{ color: "var(--fg-faint)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
