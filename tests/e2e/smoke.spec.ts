import { expect, test } from "@playwright/test";

// Trivial Playwright smoke test that confirms the browser runtime works
// without requiring our dev server to be up (which is blocked on real
// Clerk keys — see docs/ROADMAP.md notes for Slice 7).
//
// When real Clerk keys arrive, replace this with a real smoke against
// http://localhost:3001 (visit /, assert AUCKETS heading, etc.) and add
// a `webServer` block to playwright.config.ts so the dev server boots
// automatically.
test("playwright runtime is wired", async ({ page }) => {
  await page.setContent(
    "<html><body><h1 data-testid='probe'>AUCKETS smoke</h1></body></html>",
  );
  await expect(page.getByTestId("probe")).toHaveText("AUCKETS smoke");
});
