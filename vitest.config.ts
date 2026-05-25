import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    // jsdom for tests that touch the DOM (React components, etc.).
    // Pure-logic tests (the GAE especially) run fine in node — opt down
    // per-file with /** @vitest-environment node */ if needed.
    environment: "jsdom",
    globals: true,
    // Exclude Playwright's tests/ dir so vitest doesn't try to run e2e.
    exclude: ["node_modules", ".next", "tests/e2e/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
