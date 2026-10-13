import { expect, test } from "@playwright/test";
import { enterRoom, fixture, signIn } from "./helpers";

test("QA sees why an incident is paused; only the Executive can resume it", async ({ page, browser }) => {
  const { email, executiveEmail, password, pausedCode } = fixture();
  await signIn(page, email, password);
  await enterRoom(page, pausedCode, "QA Director");
  const banner = page.getByRole("status").filter({ hasText: "Paused since" });
  await expect(banner).toContainText("Lower priority than a critical incident.");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);

  const executiveContext = await browser.newContext();
  try {
    const executive = await executiveContext.newPage();
    await signIn(executive, executiveEmail, password);
    await enterRoom(executive, pausedCode, "Executive");
    await expect(executive.getByRole("status").filter({ hasText: "Paused since" })).toBeVisible();
    await executive.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(executive.getByRole("banner").filter({ hasText: pausedCode }).getByText("open", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(executive.getByRole("status").filter({ hasText: "Paused since" })).toHaveCount(0);
  } finally {
    await executiveContext.close();
  }
});

test("QA must decide pending proposals before closing an incident", async ({ page }) => {
  const { email, password, code } = fixture();
  await signIn(page, email, password);
  await enterRoom(page, code, "QA Director");
  await page.getByText("Close the incident", { exact: true }).click();
  await page.getByLabel("Reason for closing", { exact: true }).fill("Containment and investigation are complete.");
  await page.getByRole("button", { name: "Close incident", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Decide the/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("banner").filter({ hasText: code }).getByText("open", { exact: true })).toBeVisible();
});

test("QA closes a separate incident with no pending decisions", async ({ page }) => {
  const { email, password, closableCode } = fixture();
  await signIn(page, email, password);
  await enterRoom(page, closableCode, "QA Director");
  await page.getByText("Close the incident", { exact: true }).click();
  await page.getByLabel("Reason for closing", { exact: true }).fill("Containment is complete, root cause accepted and CAPA opened.");
  await page.getByRole("button", { name: "Close incident", exact: true }).click();
  // The workflow warning can replace the success line; the persisted header is authoritative.
  await expect(page.getByRole("banner").filter({ hasText: closableCode }).getByText("closed", { exact: true })).toBeVisible({ timeout: 15_000 });
});
