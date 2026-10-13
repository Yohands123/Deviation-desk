import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

interface Fixture {
  email: string;
  plantManagerEmail: string;
  supplyChainEmail: string;
  regulatoryEmail: string;
  executiveEmail: string;
  strategyEmail: string;
  password: string;
  code: string;
  pausedCode: string;
  closableCode: string;
  proposalCode: string;
  bigProposalCode: string;
}

export const fixture = () => JSON.parse(readFileSync(join(__dirname, ".fixture.json"), "utf8")) as Fixture;

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/incidents/);
}

export async function enterRoom(page: Page, code: string, seat: string): Promise<void> {
  await page.goto(`/incidents/${code}?seat=choose`);
  await page.getByRole("button", { name: new RegExp(`(Take the ${seat} seat|Continue in this seat)`) }).first().click();
  await expect(page.getByRole("region", { name: "Your seat", exact: true })).toContainText(seat);
  // The site-view spec covers WebGL; use the flat map for these incident workflow checks.
  await page.getByRole("region", { name: "Site", exact: true }).getByRole("button", { name: "Flat map", exact: true }).click();
}

