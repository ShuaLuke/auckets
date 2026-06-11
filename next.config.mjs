import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // UI-3 copy pack: the fan offer-history page moved from /my-bids to
      // /offers ("bid" is forbidden fan-facing vocabulary, and the old name
      // sat in every fan's URL bar). Permanent so bookmarks and any emailed
      // links keep working.
      { source: "/my-bids", destination: "/offers", permanent: true },
    ];
  },
};

// Sentry's Next.js plugin auto-instruments routes for error/perf reporting
// and (when a DSN + auth token are set) uploads source maps at build time.
// Without an auth token the plugin is harmless — it just skips the upload.
export default withSentryConfig(nextConfig, {
  // Suppress the upload-skipped warning at build time when source-map
  // upload isn't configured. Flip this off once we have an org/project/
  // auth token plumbed in.
  silent: true,
  // Hide source maps from the public bundle once they've been uploaded.
  // No-op until uploads are configured.
  hideSourceMaps: true,
  // Tunnel Sentry requests through our own /monitoring route to dodge
  // ad-blockers that block known Sentry domains. Adds an internal route.
  tunnelRoute: "/monitoring",
  // Disable client-side telemetry from the plugin itself.
  telemetry: false,
});
