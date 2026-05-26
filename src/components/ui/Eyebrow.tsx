// Eyebrow — small caps label above a heading. Matches the prototype's
// Eyebrow from design/ui_kits/auckets/components/Surfaces.jsx.
//
// Uses the design system's `.eyebrow` class for the typography
// (font-sans, font-weight 600, 11px, uppercase, widest tracking,
// muted fg). Keeping it as a class rather than inline lets us tune
// the global eyebrow look from one place if the design changes.

import { type HTMLAttributes } from "react";

export function Eyebrow({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`eyebrow ${className}`.trim()} {...rest} />;
}
