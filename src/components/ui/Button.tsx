// Button — pill-shaped, brand-aware. Matches the prototype's Button
// from design/ui_kits/auckets/components/Buttons.jsx.
//
// Variants:
//   primary   — ink-900 on paper-cream (default action)
//   brand     — Greenwood (the bid-flow CTA)
//   secondary — white with ink border (outline-style)
//   ghost     — transparent (low-emphasis text button)
//   inverse   — paper-cream on dark surfaces
//
// Interaction states (UI-2 feel pack): every variant has a hover shade,
// an active press (gentle scale, motion-safe so reduced-motion users get
// the color change without the squeeze), and a shared greenwood
// focus-visible ring. Variant colors live in Tailwind arbitrary-value
// classes (not inline `style`) so the hover:/active: variants can
// actually override them — inline styles would always win.

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "inverse";

export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-[var(--ink-900)] text-[color:var(--paper)] enabled:hover:bg-[var(--ink-700)]",
  brand:
    "border-transparent bg-[var(--brand)] text-[color:var(--brand-fg)] enabled:hover:bg-[var(--brand-hover)]",
  secondary:
    "border-[color:var(--border-strong)] bg-[var(--page)] text-[color:var(--ink-900)] enabled:hover:bg-[var(--paper)]",
  ghost:
    "border-transparent bg-transparent text-[color:var(--ink-900)] enabled:hover:bg-[var(--ink-100)]",
  inverse:
    "border-transparent bg-[var(--paper)] text-[color:var(--ink-900)] enabled:hover:bg-[var(--page)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  // Horizontal padding + font size match the prototype's ukBtnSizes.
  sm: "px-3 py-[5px] text-xs",
  md: "px-[18px] py-2 text-sm",
  lg: "px-[22px] py-[11px] text-[15px]",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "primary",
    size = "md",
    className = "",
    style,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center gap-2 rounded-full border font-sans font-medium leading-none transition-[color,background-color,border-color,opacity,transform] duration-150 ease-[var(--ease-out)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)] motion-safe:enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim()}
      style={{ letterSpacing: "-0.01em", ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});
