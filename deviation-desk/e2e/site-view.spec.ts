import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = () => JSON.parse(readFileSync(join(__dirname, ".fixture.json"), "utf8")) as { plantManagerEmail: string; password: string; code: string };

test("the site shows the 3D view, and switches to the flat map and back", async ({ page }) => {
  const { plantManagerEmail, password, code } = fixture();
  await page.goto("/login");
  await page.getByLabel("Email").fill(plantManagerEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/incidents/);
  await page.goto(`/incidents/${code}?seat=choose`);
  await page.getByRole("button", { name: /(Take the Plant Manager seat|Continue in this seat)/ }).first().click();

  const site = page.getByRole("region", { name: "Site" });
  await expect(site.locator("canvas")).toBeVisible({ timeout: 30_000 });
  // Room labels pair status colour with a word.
  await expect(site.getByText("Fill Room 3", { exact: true })).toBeVisible();

  await site.getByRole("button", { name: "Flat map" }).click();
  await expect(site.getByRole("img", { name: "Site floor plan with room status" })).toBeVisible();
  await expect(site.locator("canvas")).toHaveCount(0);

  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole("region", { name: "Site" }).getByRole("img", { name: "Site floor plan with room status" })).toBeVisible();
  await page.getByRole("region", { name: "Site" }).getByRole("button", { name: "3D view" }).click();
  await expect(page.getByRole("region", { name: "Site" }).locator("canvas")).toBeVisible({ timeout: 30_000 });
});
