// Button — pill-shaped, brand-aware. Matches the prototype's Button
// from design/ui_kits/auckets/components/Buttons.jsx.
//
// Variants:
//   primary   — ink-900 on paper-cream (default action)
//   brand     — Greenwood (the bid-flow CTA)
//   secondary — white with ink border (outline-style)
//   ghost     — transparent (low-emphasis text button)
//   inverse   — paper-cream on dark surfaces

import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "inverse";

export type ButtonSize = "sm" | "md" | "lg";

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--ink-900)", color: "var(--paper)" },
  brand: { background: "var(--brand)", color: "var(--brand-fg)" },
  secondary: {
    background: "var(--page)",
    color: "var(--ink-900)",
    border: "1px solid var(--border-strong)",
  },
  ghost: { background: "transparent", color: "var(--ink-900)" },
  inverse: { background: "var(--paper)", color: "var(--ink-900)" },
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
      className={`inline-flex items-center gap-2 rounded-full border border-transparent font-sans font-medium leading-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${className}`.trim()}
      style={{ ...variantStyles[variant], letterSpacing: "-0.01em", ...style }}
      {...rest}
    >
      {children}
    </button>
  );
});
