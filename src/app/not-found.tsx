// Branded 404 (UI-2 feel pack). Replaces Next's unstyled default with the
// paper-and-display-type treatment the rest of the app wears. Rendered by
// the root layout (so the SiteNav stays up top) for any unmatched route
// and every notFound() call in the fan pages.

import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";

export default function NotFound() {
  return (
    <main
      className="flex min-h-[calc(100vh-57px)] items-center"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto w-full max-w-[640px] px-4 py-16 text-center md:px-8">
        <Eyebrow className="mb-3">404</Eyebrow>
        <h1 className="display-2" style={{ fontSize: "clamp(2rem, 7vw, 3.5rem)" }}>
          This page didn&apos;t make the lineup.
        </h1>
        <p
          className="mx-auto mt-4 font-sans text-[15px]"
          style={{ color: "var(--fg-muted)", maxWidth: 420 }}
        >
          The address may have changed, or it never existed. The shows are
          still where you left them.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/" className="border-0 no-underline">
            <Button variant="primary">Go home</Button>
          </Link>
          <Link href="/shows" className="border-0 no-underline">
            <Button variant="secondary">See the lineup</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
