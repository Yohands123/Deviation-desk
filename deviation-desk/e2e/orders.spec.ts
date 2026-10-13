import { expect, test } from "@playwright/test";
import { fixture, signIn } from "./helpers";

test("the Supply Chain Lead logs a routine customer order", async ({ page }) => {
  const { supplyChainEmail, password } = fixture();
  await signIn(page, supplyChainEmail, password);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);

  const orders = page.getByRole("list", { name: "Orders", exact: true });
  await expect(orders).toBeVisible();
  const initialCount = await orders.getByRole("listitem").count();
  await page.getByRole("combobox", { name: "Product", exact: true }).selectOption({ label: "HLX-201 injection, 100 mg/mL" });
  await page.getByRole("combobox", { name: "For", exact: true }).selectOption({ label: "Northshore Hospital Pharmacy" });
  await page.getByLabel("Units", { exact: true }).fill("300");
  const due = new Date();
  due.setDate(due.getDate() + 20);
  const localDue = new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Due", { exact: true }).fill(localDue);
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption({ label: "Routine" });
  await page.getByRole("button", { name: "Log the order", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/Logged ORD-\d+|workflow engine is not running/, { timeout: 15_000 });
  await expect(orders.getByRole("listitem")).toHaveCount(initialCount + 1);
  const order = orders.getByRole("listitem").filter({ hasText: "Logged by Tomás Reyes" });
  await expect(order).toHaveCount(1);
  await expect(order.getByText("300 units", { exact: true })).toBeVisible();
  await expect(order).toContainText("Northshore Hospital Pharmacy");
  await expect(order.getByText("Routine", { exact: true })).toBeVisible();
  await expect(order.getByText(/^ORD-\d+$/)).toBeVisible();
});
