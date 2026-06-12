import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // tsconfig sets jsx:"preserve" (Next transforms JSX itself), which would
  // leave JSX untransformed under the test runner. Force the automatic runtime
  // so server modules that import .tsx email templates (e.g. the notifications
  // dispatch pulled in by the Stripe webhook) transform in tests. Vitest 4
  // transforms with oxc, NOT esbuild — an `esbuild: { jsx }` option is silently
  // ignored — so the runtime has to be set on `oxc`.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // jsdom for tests that touch the DOM (React components, etc.).
    // Pure-logic tests (the GAE especially) run fine in node — opt down
    // per-file with /** @vitest-environment node */ if needed.
    environment: "jsdom",
    globals: true,
    // src/lib/env.ts validates required vars at import time, and vitest
    // deliberately loads no .env files — so any suite that (transitively)
    // imports env.ts needs these present. These are the same format-valid
    // placeholders ci.yml uses; anything already set in the shell wins, so
    // CI's explicit values pass through untouched. Unit tests never reach
    // a real DB or Clerk, so placeholder values are all they need.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://placeholder@localhost:5432/aucket",
      NEXT_PUBLIC_APP_URL:
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
        "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
      CLERK_SECRET_KEY:
        process.env.CLERK_SECRET_KEY ??
        "sk_test_BzfCk3uvy7Wxam6Ym7Vmpl6Ic37cuhFsZ4kc8Lz9G5",
    },
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
