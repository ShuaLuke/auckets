// The pre-launch gate screen (`/unlock`).
//
// The middleware redirects here whenever SITE_PASSWORD is set and the
// visitor hasn't presented it yet. A Server Component + a Server Action, so
// there's no client JS and the password never enters the browser bundle:
// the form posts the password to `unlock`, which compares it server-side and
// (on success) sets the gate cookie and sends the visitor on their way.
//
// If SITE_PASSWORD is unset the middleware never routes here, but visiting
// directly is harmless — the action just waves the visitor through.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { TextInput } from "@/components/ui/TextInput";
import { env } from "@/lib/env";
import { GATE_COOKIE_NAME, gateCookieValue } from "@/lib/site-gate";

// Reads cookies / sets cookies — must run per-request, never static.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Enter password",
  // No reason to let the gate screen show up in search results.
  robots: { index: false, follow: false },
};

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Only ever redirect to a same-origin absolute path — never an open redirect
// (`//evil.com`, `https://…`). Anything else falls back to the home page.
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

async function unlock(formData: FormData) {
  "use server";

  const password = env.SITE_PASSWORD;
  const nextRaw = formData.get("next");
  const next = safeNext(typeof nextRaw === "string" ? nextRaw : undefined);

  // Gate disabled → nothing to unlock; just go in.
  if (!password) redirect(next);

  const submitted = formData.get("password");
  if (typeof submitted === "string" && submitted === password) {
    cookies().set(GATE_COOKIE_NAME, await gateCookieValue(password), {
      httpOnly: true,
      sameSite: "lax",
      // Secure in any https deployment; off for local http://localhost.
      secure: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    redirect(next);
  }

  redirect(`/unlock?error=1&next=${encodeURIComponent(next)}`);
}

export default function UnlockPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const hasError = searchParams.error === "1";
  const next = safeNext(searchParams.next);

  return (
    // data-gate-screen drives a global rule in globals.css that hides the
    // root layout's site header on this page only — a locked-out visitor
    // shouldn't see Shows / Sign in nav they can't use yet. Keeping the
    // toggle in CSS (vs. plumbing the pathname into the Server Component
    // nav) keeps the gate self-contained to these two files.
    <main
      data-gate-screen
      className="flex min-h-screen items-center justify-center px-5 py-16"
      style={{ background: "var(--paper)" }}
    >
      <div className="w-full" style={{ maxWidth: 420 }}>
        <div
          className="rounded-xl border"
          style={{
            background: "var(--page)",
            borderColor: "var(--ink-900)",
            padding: 32,
            boxShadow: "6px 6px 0 0 var(--ink-900)",
          }}
        >
          <Eyebrow className="mb-3">Private preview</Eyebrow>
          <h1
            className="font-display font-bold mb-2.5"
            style={{ fontSize: 28, lineHeight: 1.1, letterSpacing: "-0.025em" }}
          >
            AUCKETS is invite-only right now.
          </h1>
          <p
            className="font-sans mb-6"
            style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink-500)" }}
          >
            Enter the access password to continue. Don&rsquo;t have one? Hang
            tight — we&rsquo;re opening up soon.
          </p>

          <form action={unlock} className="flex flex-col gap-3">
            <input type="hidden" name="next" value={next} />
            <TextInput
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              placeholder="Access password"
              aria-label="Access password"
              aria-invalid={hasError}
              className="w-full"
            />
            {hasError && (
              <p
                className="font-sans"
                style={{ fontSize: 13, color: "var(--brick-500)" }}
                role="alert"
              >
                That password didn&rsquo;t match. Try again.
              </p>
            )}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full justify-center"
            >
              Enter
            </Button>
          </form>
        </div>

        <p
          className="mt-4 text-center font-sans"
          style={{ fontSize: 12, color: "var(--ink-400)" }}
        >
          AUCKETS — not an auction.
        </p>
      </div>
    </main>
  );
}
