import { expect, test } from "@playwright/test";
import { fixture, signIn } from "./helpers";

const LESSON = "Never propose holding a delivered shipment; flag it for a recall assessment instead.";

test("QA approves a proposed agent lesson; Strategy & Growth cannot approve lessons", async ({ page, browser }) => {
  const { email, strategyEmail, password } = fixture();
  const strategyContext = await browser.newContext();
  try {
    const strategy = await strategyContext.newPage();
    await signIn(strategy, strategyEmail, password);
    await strategy.goto("/agents");
    const proposed = strategy.getByRole("region", { name: "Lessons", exact: true }).getByRole("listitem").filter({ hasText: LESSON });
    await expect(proposed.getByText("proposed", { exact: true })).toBeVisible();
    await expect(strategy.getByRole("button", { name: /Approve/ })).toHaveCount(0);

    await signIn(page, email, password);
    await page.goto("/agents");
    const lesson = page.getByRole("region", { name: "Lessons", exact: true }).getByRole("listitem").filter({ hasText: LESSON });
    await expect(lesson.getByText("proposed", { exact: true })).toBeVisible();
    await lesson.getByRole("button", { name: "Approve: add to the agent", exact: true }).click();
    await expect(lesson.getByText("active", { exact: true })).toBeVisible();
    await expect(lesson).toContainText("Elena Duarte");
    await expect(lesson.getByRole("button", { name: "Approve: add to the agent", exact: true })).toHaveCount(0);
  } finally {
    await strategyContext.close();
  }
});
