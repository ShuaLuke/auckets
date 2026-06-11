// Card — bordered surface for content groups. Matches the prototype's
// Card from design/ui_kits/auckets/components/Surfaces.jsx.
//
// Variants:
//   default — white surface, subtle border (standard)
//   warm    — paper-cream surface, subtle border (sticky composer)
//   sunken  — paper-2 cream surface, no border (Heads-up note)
//   inverse — ink-900 surface, paper text (preview banner)
//   outline — white surface, ink-900 border (poster-style emphasis)
//
// `interactive` (UI-2 feel pack): for cards that are click targets — adds
// a ~150ms hover lift (border-strong + soft shadow + 1px rise). The rise
// is motion-safe; reduced-motion users still get the border/shadow cue.
// Variant colors live in Tailwind classes (not inline `style`) so the
// hover: variants can override them; callers passing `style` overrides
// still win, exactly as before.

import { type HTMLAttributes } from "react";

export type CardVariant = "default" | "warm" | "sunken" | "inverse" | "outline";

const variantClasses: Record<CardVariant, string> = {
  default: "border border-[color:var(--border)] bg-[var(--page)]",
  warm: "border border-[color:var(--border)] bg-[var(--paper)]",
  sunken: "bg-[var(--paper-2)]",
  inverse: "bg-[var(--ink-900)] text-[color:var(--paper)]",
  outline: "border border-[color:var(--ink-900)] bg-[var(--page)]",
};

const interactiveClasses =
  "transition-[border-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] hover:border-[color:var(--border-strong)] hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-px";

type Props = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  // Hover lift for cards that act as click targets (rows, link wrappers).
  interactive?: boolean;
};

export function Card({
  variant = "default",
  interactive = false,
  className = "",
  style,
  ...rest
}: Props) {
  return (
    <div
      className={`rounded-xl p-5 ${variantClasses[variant]} ${
        interactive ? interactiveClasses : ""
      } ${className}`.trim()}
      style={style}
      {...rest}
    />
  );
}
