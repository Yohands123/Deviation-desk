import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = () => JSON.parse(readFileSync(join(__dirname, ".fixture.json"), "utf8")) as { email: string; password: string; code: string };

test("seat picker → incident room → approve a decision", async ({ page }) => {
  const { email, password, code } = fixture();

  await page.goto("/incidents");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: new RegExp(code) }).click();
  await expect(page.getByRole("heading", { name: "Choose your seat" })).toBeVisible();
  await page.getByRole("button", { name: "Take the QA Director seat" }).click();

  const card = page.getByRole("article", { name: /Decision: Hold batches/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("A-2235").first()).toBeVisible();
  await expect(page.getByText("LIVE", { exact: true }).first()).toBeVisible();

  await card.getByRole("button", { name: "Approve: hold batches" }).click();
  await expect(page.getByText("Nothing is waiting for your seat right now.")).toBeVisible();
  await expect(page.getByText('Approved "Hold batches".')).toBeVisible();
});
