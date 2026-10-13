import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = () => JSON.parse(readFileSync(join(__dirname, ".fixture.json"), "utf8")) as { email: string; password: string };

// People only (agents off), so the run makes no model calls.
test("start a drill from the library, step it, play in the drill room, end it and read the debrief", async ({ page }) => {
  const { email, password } = fixture();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/incidents/);

  await page.goto("/drills");
  await page.getByText("Sterility failure on Line 3").click();
  await page.getByLabel(/AI agents respond/).uncheck();
  await page.getByPlaceholder("Random").fill("7");
  await page.getByRole("button", { name: "Start the drill" }).click();
  await page.waitForURL(/\/drills\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  const clock = page.getByRole("region", { name: "Drill clock" });
  await expect(clock).toContainText("Hour 0");
  await expect(page.getByText("DRILL", { exact: true })).toBeVisible();
  for (const hour of [1, 2]) {
    await page.getByRole("button", { name: "Step one hour" }).click();
    await expect(clock).toContainText(`Hour ${hour}`);
  }

  // The drill room is the incident room inside the drill world, never marked LIVE.
  await page.getByRole("link", { name: "Enter the drill incident room" }).click();
  await expect(page.getByText("Drill hour 2")).toBeVisible();
  await expect(page.getByText("DRILL", { exact: true })).toBeVisible();
  await expect(page.getByText("LIVE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Site" })).toBeVisible();

  await page.getByRole("link", { name: "Drill console" }).first().click();
  await page.getByRole("button", { name: "End drill" }).click();
  await page.getByRole("button", { name: "End the drill" }).click();
  await page.waitForURL(/\/debrief$/);
  await expect(page.getByRole("heading", { name: "Sterility failure on Line 3" })).toBeVisible();
  await expect(page.getByText(/\d+ \/ 100/)).toBeVisible();
  await expect(page.getByText("The hidden truth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask the Auditor" })).toBeVisible();
});
