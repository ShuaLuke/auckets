import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Integration tests run against a real Postgres. The default `npm test`
// (vitest.config.ts) excludes this directory and stays mock-DB only so it
// keeps running everywhere without Docker.
//
// Why a separate config:
//   - environment: 'node' — these tests never touch the DOM, and JSDOM adds
//     ~1s of startup per file
//   - fileParallelism: false — every test file shares the same Postgres
//     database; running them in parallel would have one test's truncate
//     clobber another's seed mid-flight
//   - globalSetup — runs migrations once for the whole run (~1s) instead of
//     per file (~Nx slower)
//   - test.env — provides DATABASE_URL + Clerk dummies so src/lib/env.ts's
//     Zod validator passes at import time. The DATABASE_URL here is the
//     local Docker default; override via TEST_DATABASE_URL in the shell or
//     in CI. tests/integration/global-setup.ts refuses to run if the URL
//     points anywhere that looks like staging/prod — defense-in-depth so a
//     stray env var can't TRUNCATE the wrong database.
export default defineConfig({
  // tsconfig sets jsx:"preserve" (Next transforms JSX itself), which would
  // leave JSX untransformed under Vitest's esbuild. Force the automatic
  // runtime — mirrors vitest.config.ts — so server modules that import .tsx
  // email templates (run-binding + the Stripe webhook, via the notifications
  // dispatch) transform in the integration suite too.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5433/auckets_test",
      NEXT_PUBLIC_APP_URL: "http://localhost:3001",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
      CLERK_SECRET_KEY: "sk_test_BzfCk3uvy7Wxam6Ym7Vmpl6Ic37cuhFsZ4kc8Lz9G5",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
