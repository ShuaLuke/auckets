// MarqueeButton — the design's poster-style CTA. White background, ink
// border, hard 4px offset shadow. On hover the shadow collapses to 2px
// and the button translates 2px down-right so the visual offset stays
// constant — the "stamping in" animation that's iconic to the design.
//
// Matches design/ui_kits/auckets/components/Buttons.jsx MarqueeButton.
// Used by Landing.jsx (Create an account, Pitch your venue) and any
// place we want the highest-emphasis CTA.
//
// Distinct from Button (pill, no shadow). If you're adding a primary
// or brand CTA, prefer Button — MarqueeButton is reserved for hero /
// section-leading CTAs where the poster effect is wanted.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  // Renders right after the label inside the button. Lets callers pass
  // a lucide-react <ArrowRight /> or similar without this component
  // having to know about an icon set.
  iconAfter?: ReactNode;
  iconBefore?: ReactNode;
};

export const MarqueeButton = forwardRef<HTMLButtonElement, Props>(
  function MarqueeButton(
    { children, iconAfter, iconBefore, className = "", style, type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`group inline-flex items-center gap-2.5 rounded-lg border font-sans font-semibold leading-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
        style={{
          padding: "11px 22px",
          fontSize: 15,
          letterSpacing: "-0.01em",
          background: "var(--page)",
          color: "var(--ink-900)",
          borderColor: "var(--ink-900)",
          boxShadow: "4px 4px 0 0 var(--ink-900)",
          transitionTimingFunction: "var(--ease-out)",
          ...style,
        }}
        // Hover effect is done with inline event handlers rather than
        // :hover styles because the shadow + transform need to stay in
        // visual sync, and Tailwind's hover: variants don't compose
        // cleanly with custom box-shadow + transform together. Three
        // lines of JS for a one-shot landing animation is fine.
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "2px 2px 0 0 var(--ink-900)";
          e.currentTarget.style.transform = "translate(2px, 2px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "4px 4px 0 0 var(--ink-900)";
          e.currentTarget.style.transform = "translate(0, 0)";
        }}
        {...rest}
      >
        {iconBefore}
        {children}
        {iconAfter}
      </button>
    );
  },
);
