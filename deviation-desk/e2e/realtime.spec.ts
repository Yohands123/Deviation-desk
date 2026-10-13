import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const fixture = () =>
  JSON.parse(readFileSync(join(__dirname, ".fixture.json"), "utf8")) as { email: string; plantManagerEmail: string; password: string; code: string };

async function enterRoom(browser: Browser, email: string, password: string, code: string, seat: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/incidents/);
  await page.goto(`/incidents/${code}?seat=choose`);
  await page.getByRole("button", { name: new RegExp(`(Take the ${seat} seat|Continue in this seat)`) }).first().click();
  await expect(page.getByText("Live updates on")).toBeVisible({ timeout: 15_000 });
  return page;
}

test("a change made in one seat appears in another without reloading", async ({ browser }) => {
  const { email, plantManagerEmail, password, code } = fixture();
  const qa = await enterRoom(browser, email, password, code, "QA Director");
  const plant = await enterRoom(browser, plantManagerEmail, password, code, "Plant Manager");

  const note = `Filler 3 gasket inspected at ${Date.now()}: visible wear on the needle seal.`;
  await plant.getByLabel("Add evidence").fill(note);
  await plant.getByRole("button", { name: "Add evidence" }).click();
  await expect(plant.getByText("Evidence added.")).toBeVisible();

  // The QA Director's page was never reloaded; Realtime must bring the note in.
  await expect(qa.getByText(note).first()).toBeVisible({ timeout: 10_000 });
});
