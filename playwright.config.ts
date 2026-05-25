import { defineConfig, devices } from "@playwright/test";

// Playwright is configured but intentionally minimal until real Clerk
// dev keys land. Once they do, we'll start the dev server here
// (webServer: { command: "npm run dev", url: "http://localhost:3001" })
// and add real smoke tests against the app.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  // Pin a single worker in CI so flake from concurrent browsers is less
  // confusing; in local dev let Playwright pick (omit the field with
  // exactOptionalPropertyTypes on).
  ...(isCI ? { workers: 1 } : {}),
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
