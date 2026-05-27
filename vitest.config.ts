import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    // jsdom for tests that touch the DOM (React components, etc.).
    // Pure-logic tests (the GAE especially) run fine in node — opt down
    // per-file with /** @vitest-environment node */ if needed.
    environment: "jsdom",
    globals: true,
    // Exclude Playwright's e2e and the real-Postgres integration suite —
    // both have their own runners (npx playwright / npm run test:integration).
    exclude: ["node_modules", ".next", "tests/e2e/**", "tests/integration/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
