/**
 * Inngest functions:
 * - one per event handler, so every agent call is a durable, retryable step;
 * - the approval gate: waits for a human decision on each proposal, escalating (notify only)
 *   when it takes too long (Layer 4, CLAUDE.md §8);
 * - the Layer-1 reading watcher on a schedule.
 */
import "server-only";
import { escalationPlan } from "@/approvals/escalation";
import { getSql } from "@/db/client";
import { runReadingWatchers } from "@/monitoring/run-watchers";
import { inngest } from "./client";
import { ApprovalRequested } from "./events";
import { handlers, type NamedHandler, type StepRunner } from "./handlers";
import { addIncidentEvent } from "./incidents";

interface StepTools {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
}

// Inngest returns step results as JSON; handlers only return plain JSON values from steps.
const stepRunner = (step: StepTools): StepRunner => (id, fn) => step.run(id, fn) as never;

function handlerFunction(event: string, { id, handle }: NamedHandler) {
  return inngest.createFunction({ id, triggers: [{ event }] }, async ({ event: e, step }) => {
    const emitted = await handle(stepRunner(step), e.data);
    if (emitted.length > 0) await step.sendEvent("emit", emitted);
    return { emitted: emitted.map((x) => x.name) };
  });
}

const approvalGate = inngest.createFunction(
  { id: "approval-gate", triggers: [{ event: "approval/requested" }] },
  async ({ event, step }) => {
    const req = ApprovalRequested.parse(event.data);
    const scope = { worldId: req.worldId, companyId: req.companyId, incidentId: req.incidentId };
    const plan = escalationPlan(req.seat, req.severity);

    for (const [i, stage] of plan.entries()) {
      // Wait for the decision on this exact proposal (ids are uuids from our database).
      const decision = await step.waitForEvent(`wait-${i}`, {
        event: "decision/resolved",
        timeout: stage.wait,
        if: `async.data.decisionRecordId == "${req.decisionRecordId}"`,
      });
      if (decision) return { status: "decided" };

      if (stage.notify) {
        // Escalation tells the next seat; authority to decide stays with the owning seat.
        await step.run(`escalate-${i}`, () =>
          addIncidentEvent(getSql(), scope, {
            actorType: "system",
            actorId: "approval-gate",
            eventType: "approval_escalated",
            payload: { decisionRecordId: req.decisionRecordId, owner: req.seat, notified: stage.notify, waited: stage.wait },
          }),
        );
        await step.sendEvent(`notify-${i}`, {
          name: "incident/escalated",
          data: { ...scope, decisionRecordId: req.decisionRecordId, owner: req.seat, notify: stage.notify, reason: `No decision after ${stage.wait}` },
        });
      } else {
        await step.run(`overdue-${i}`, () =>
          addIncidentEvent(getSql(), scope, {
            actorType: "system",
            actorId: "approval-gate",
            eventType: "approval_overdue",
            payload: { decisionRecordId: req.decisionRecordId, owner: req.seat },
          }),
        );
      }
    }
    return { status: "overdue" };
  },
);

const readingWatcher = inngest.createFunction(
  { id: "watch-readings", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const events = await step.run("scan", () => runReadingWatchers(getSql()));
    if (events.length > 0) await step.sendEvent("emit", events);
    return { emitted: events.length };
  },
);

export const functions = [
  ...Object.entries(handlers).flatMap(([event, list]) => list.map((h) => handlerFunction(event, h))),
  approvalGate,
  readingWatcher,
];
