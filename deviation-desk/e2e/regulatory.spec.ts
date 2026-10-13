import { expect, test } from "@playwright/test";
import { enterRoom, fixture, signIn } from "./helpers";

test("Regulatory Affairs sees a confirmed obligation and its approved notification", async ({ page }) => {
  const { regulatoryEmail, password, code } = fixture();
  await signIn(page, regulatoryEmail, password);
  await enterRoom(page, code, "Regulatory Affairs");
  const panel = page.getByRole("region", { name: "Regulatory and messages", exact: true });
  await expect(panel.getByText("NMA-QD-1", { exact: true })).toBeVisible();
  await expect(panel.getByText("Initial quality defect report", { exact: true })).toBeVisible();
  await expect(panel.getByText(/Demo library: these rules are fictional/)).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Reporting obligations", exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
});
