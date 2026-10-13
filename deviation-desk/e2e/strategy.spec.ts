import { expect, test } from "@playwright/test";
import { fixture, signIn } from "./helpers";

test("Strategy & Growth approves a simulated proposal; QA cannot approve it", async ({ page, browser }) => {
  const { email, strategyEmail, password, proposalCode, bigProposalCode } = fixture();
  const qaContext = await browser.newContext();
  try {
    // Check access while both proposals are still pending, so missing buttons prove permissions.
    const qa = await qaContext.newPage();
    await signIn(qa, email, password);
    await qa.goto("/strategy");
    await expect(qa.getByRole("article", { name: new RegExp(`^${proposalCode}:`) })).toBeVisible();
    await expect(qa.getByRole("article", { name: new RegExp(`^${bigProposalCode}:`) })).toBeVisible();
    await expect(qa.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

    await signIn(page, strategyEmail, password);
    await page.goto("/strategy");
    const proposal = page.getByRole("article", { name: new RegExp(`^${proposalCode}:`) });
    await expect(proposal.getByText("proposed", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("heading", { name: "Simulate before you build" })).toBeVisible();
    const table = proposal.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Today", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "With the change", exact: true })).toBeVisible();
    const slots = table.getByRole("row").filter({ hasText: "Sterility test slots" });
    await expect(slots).toBeVisible();
    const before = Number(await slots.getByRole("cell").nth(1).innerText());
    await expect(slots.getByRole("cell").nth(2)).toHaveText(String(before + 2));
    await expect(proposal).toContainText("$90,000");
    await proposal.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(proposal.getByText("approved", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  } finally {
    await qaContext.close();
  }
});

test("large expansion spend needs Strategy & Growth and Executive approval", async ({ page, browser }) => {
  const { strategyEmail, executiveEmail, password, bigProposalCode } = fixture();
  await signIn(page, strategyEmail, password);
  await page.goto("/strategy");
  const proposal = page.getByRole("article", { name: new RegExp(`^${bigProposalCode}:`) });
  await expect(proposal).toContainText("$320,000");
  await proposal.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(proposal.getByRole("status")).toContainText("The spend also needs the Executive");
  await expect(proposal.getByText("proposed", { exact: true })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  const executiveContext = await browser.newContext();
  try {
    const executive = await executiveContext.newPage();
    await signIn(executive, executiveEmail, password);
    await executive.goto("/strategy");
    const executiveProposal = executive.getByRole("article", { name: new RegExp(`^${bigProposalCode}:`) });
    await executiveProposal.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(executiveProposal.getByText("approved", { exact: true })).toBeVisible();
    await expect(executiveProposal).toContainText("(Strategy & Growth)");
    await expect(executiveProposal).toContainText("(Executive)");
  } finally {
    await executiveContext.close();
  }
});
