// Card — bordered surface for content groups. Matches the prototype's
// Card from design/ui_kits/auckets/components/Surfaces.jsx.
//
// Variants:
//   default — white surface, subtle border (standard)
//   warm    — paper-cream surface, subtle border (sticky composer)
//   sunken  — paper-2 cream surface, no border (Heads-up note)
//   inverse — ink-900 surface, paper text (preview banner)
//   outline — white surface, ink-900 border (poster-style emphasis)

import { type HTMLAttributes } from "react";

export type CardVariant = "default" | "warm" | "sunken" | "inverse" | "outline";

const variants: Record<CardVariant, React.CSSProperties> = {
  default: {
    background: "var(--page)",
    border: "1px solid var(--border)",
  },
  warm: {
    background: "var(--paper)",
    border: "1px solid var(--border)",
  },
  sunken: {
    background: "var(--paper-2)",
    border: 0,
  },
  inverse: {
    background: "var(--ink-900)",
    color: "var(--paper)",
    border: 0,
  },
  outline: {
    background: "var(--page)",
    border: "1px solid var(--ink-900)",
  },
};

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

export function Card({
  variant = "default",
  className = "",
  style,
  ...rest
}: Props) {
  return (
    <div
      className={`rounded-xl p-5 ${className}`.trim()}
      style={{ ...variants[variant], ...style }}
      {...rest}
    />
  );
}
