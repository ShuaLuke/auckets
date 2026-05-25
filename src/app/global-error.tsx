"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// Next.js App Router error boundary for React rendering errors that escape
// every other error.tsx. Per Sentry's docs we forward the error so it shows
// up in Sentry instead of just rendering the default 500. Captures are
// silently no-op'd when no DSN is configured.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
