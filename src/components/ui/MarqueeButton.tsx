// MarqueeButton — the design's poster-style CTA. White background, ink
// border, hard 4px offset shadow. On hover the shadow collapses to 2px
// and the button translates 2px down-right so the visual offset stays
// constant — the "stamping in" animation that's iconic to the design.
// On press (:active) it stamps the rest of the way (1px shadow).
//
// Matches design/ui_kits/auckets/components/Buttons.jsx MarqueeButton.
// Used by Landing.jsx (Create an account, Pitch your venue) and any
// place we want the highest-emphasis CTA.
//
// Distinct from Button (pill, no shadow). If you're adding a primary
// or brand CTA, prefer Button — MarqueeButton is reserved for hero /
// section-leading CTAs where the poster effect is wanted.
//
// The stamp used to be inline onMouseEnter/onMouseLeave handlers (which
// forced "use client" and gave keyboard + touch users nothing). It's now
// pure CSS — :hover and :focus-visible both stamp, so tabbing onto the
// button reads the same as mousing over it, and the component can render
// from Server Components again. The translate halves are motion-safe:
// reduced-motion users still get the shadow change (a color/size cue),
// never the movement. The shadow color is the --auk-stamp custom property
// so callers can re-ink the stamp (the landing page's amber variant) and
// every state stays in sync.

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  // Renders right after the label inside the button. Lets callers pass
  // a lucide-react <ArrowRight /> or similar without this component
  // having to know about an icon set.
  iconAfter?: ReactNode;
  iconBefore?: ReactNode;
  // Stamp (hard shadow) color. Defaults to ink; the landing page passes
  // the marquee amber for the venue-pitch CTA.
  stampColor?: string;
};

export const MarqueeButton = forwardRef<HTMLButtonElement, Props>(
  function MarqueeButton(
    {
      children,
      iconAfter,
      iconBefore,
      stampColor = "var(--ink-900)",
      className = "",
      style,
      type = "button",
      ...rest
    },
    ref,
  ) {
    // CSSProperties doesn't model custom properties; the cast is sound
    // because React passes unknown keys straight through to the style
    // attribute, where --auk-stamp is valid CSS.
    const stampVar = { "--auk-stamp": stampColor } as CSSProperties;
    return (
      <button
        ref={ref}
        type={type}
        className={`group inline-flex items-center gap-2.5 rounded-lg border font-sans font-semibold leading-none shadow-[4px_4px_0_0_var(--auk-stamp)] transition-all duration-150 hover:shadow-[2px_2px_0_0_var(--auk-stamp)] focus-visible:shadow-[2px_2px_0_0_var(--auk-stamp)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand)] enabled:active:shadow-[1px_1px_0_0_var(--auk-stamp)] motion-safe:hover:translate-x-[2px] motion-safe:hover:translate-y-[2px] motion-safe:focus-visible:translate-x-[2px] motion-safe:focus-visible:translate-y-[2px] motion-safe:enabled:active:translate-x-[3px] motion-safe:enabled:active:translate-y-[3px] disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
        style={{
          padding: "11px 22px",
          fontSize: 15,
          letterSpacing: "-0.01em",
          background: "var(--page)",
          color: "var(--ink-900)",
          borderColor: "var(--ink-900)",
          transitionTimingFunction: "var(--ease-out)",
          ...stampVar,
          ...style,
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
