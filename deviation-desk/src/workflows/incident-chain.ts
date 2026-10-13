/**
 * The first agent chain (Phase 2). Each step is durable: retried on failure, resumable after waits.
 * Event names: docs/DOMAIN.md §Event names. Written against Inngest v4 (triggers inside the options object).
 */
import { inngest } from "./client";
import { runAgent } from "../agents/runner";
import { getAgent } from "../agents/registry";

type IncidentOpened = { worldId: string; companyId: string; incidentId: string; summary: string };

export const incidentChain = inngest.createFunction(
  { id: "incident-chain", triggers: [{ event: "incident/opened" }] },
  async ({ event, step }) => {
    const data = event.data as IncidentOpened;
    const ctx = { worldId: data.worldId, companyId: data.companyId, incidentId: data.incidentId };

    // 1. Gather evidence (no conclusions).
    const evidence = await step.run("evidence-collector", () =>
      runAgent({
        agent: getAgent("evidence_collector"),
        ctx: { ...ctx, agentId: "evidence_collector" },
        task: `Incident opened: ${data.summary}. Collect related records and flag missing ones.`,
      }),
    );

    // 2. Propose a root cause.
    const rootCause = await step.run("root-cause-analyst", () =>
      runAgent({
        agent: getAgent("root_cause_analyst"),
        ctx: { ...ctx, agentId: "root_cause_analyst" },
        task: `Propose the most likely root cause for: ${data.summary}. Evidence summary: ${evidence.record.answer.summary}`,
      }),
    );

    // 3. Challenge it.
    await step.run("devils-advocate", () =>
      runAgent({
        agent: getAgent("devils_advocate"),
        ctx: { ...ctx, agentId: "devils_advocate" },
        task: `Challenge this proposed root cause: ${rootCause.record.answer.summary}`,
      }),
    );

    // 4. Pause for the QA Director. Escalate if nobody answers.
    // TODO(Phase 3): persist the decision record id and match on it.
    const decision = await step.waitForEvent("wait-for-qa-decision", {
      event: "decision/resolved",
      timeout: "2h",
      if: `async.data.incidentId == "${data.incidentId}"`,
    });

    if (!decision) {
      await step.sendEvent("escalate", { name: "incident/escalated", data: { ...ctx, reason: "QA decision timed out" } });
      return { status: "escalated" };
    }
    return { status: "resolved", outcome: (decision.data as { outcome?: string }).outcome ?? "unknown" };
  },
);
