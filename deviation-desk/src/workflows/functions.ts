/**
 * Inngest functions:
 * - one per event handler, so every agent call is a durable, retryable step;
 * - the approval gate: waits for a human decision on each proposal, escalating (notify only)
 *   when it takes too long (Layer 4, CLAUDE.md §8);
 * - the Layer-1 reading watcher on a schedule;
 * - outbox delivery of approved messages (live worlds only; src/comms/outbox.ts).
 */
import "server-only";
import { z } from "zod";
import { escalationPlan } from "@/approvals/escalation";
import { deliverMessage } from "@/comms/outbox";
import { getSql } from "@/db/client";
import { runReadingWatchers } from "@/monitoring/run-watchers";
import { auditChecks } from "@/oversight/audit-checks";
import { inngest } from "./client";
import { drillAudit, drillAutoplay } from "./drill-functions";
import { ApprovalRequested, OutboundReady } from "./events";
import { handlers, type NamedHandler, type StepRunner } from "./handlers";
import { addIncidentEvent, firstTime, isPaused, RUNS_WHILE_PAUSED } from "./incidents";

interface StepTools {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
}

// Inngest returns step results as JSON; handlers only return plain JSON values from steps.
const stepRunner = (step: StepTools): StepRunner => (id, fn) => step.run(id, fn) as never;

const IncidentRef = z.object({ worldId: z.uuid(), incidentId: z.uuid() });

/**
 * Scheduled agent work (hourly audit, weekly reviews) costs money with nobody watching; a hosted
 * deployment can switch it off with SCHEDULED_AGENTS=off. Watchers and approvals still run.
 */
const scheduledAgentsOn = () => process.env.SCHEDULED_AGENTS !== "off";

function handlerFunction(event: string, { id, handle }: NamedHandler) {
  return inngest.createFunction({ id, triggers: [{ event }] }, async ({ event: e, step }) => {
    // A paused incident's work waits here, state saved, until someone resumes it (CLAUDE.md §8).
    const ref = IncidentRef.safeParse(e.data);
    if (ref.success && !RUNS_WHILE_PAUSED.has(event)) {
      const paused = await step.run("check-paused", () => isPaused(getSql(), ref.data.worldId, ref.data.incidentId));
      if (paused) {
        const resumed = await step.waitForEvent("wait-for-resume", {
          event: "incident/resumed",
          timeout: "7d",
          if: `async.data.incidentId == "${ref.data.incidentId}"`,
        });
        if (!resumed) return { skipped: "incident stayed paused" };
      }
    }
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

const deliverOutbound = inngest.createFunction(
  { id: "deliver-outbound", triggers: [{ event: "outbound/ready" }], retries: 4 },
  async ({ event, step }) => {
    const { worldId, messageId } = OutboundReady.parse(event.data);
    const result = await step.run("deliver", () => deliverMessage(getSql(), worldId, messageId));
    // A failed attempt throws so Inngest retries with backoff; the message records each attempt.
    if (result === "retry") throw new Error(`Delivery of message ${messageId} failed; retrying.`);
    return { result };
  },
);

/** Layer 3 (CLAUDE.md §8): the weekly expansion review for every live company, Mondays 07:00 at the site. */
const weeklyExpansionReview = inngest.createFunction(
  { id: "weekly-expansion-review", triggers: [{ cron: "TZ=America/Toronto 0 7 * * 1" }] },
  async ({ step }) => {
    if (!scheduledAgentsOn()) return { skipped: "SCHEDULED_AGENTS=off" };
    const worlds = await step.run("live-worlds", () => getSql()<{ worldId: string; companyId: string }[]>`select id as world_id, company_id from worlds where kind = 'live' and status = 'active'`);
    if (worlds.length > 0) await step.sendEvent("sweep", worlds.map((w) => ({ name: "expansion/sweep", data: w })));
    return { companies: worlds.length };
  },
);

/** Layer 3: the Auditor's hourly sweep. Code checks first; the agent runs only for new gaps. */
const hourlyAudit = inngest.createFunction(
  { id: "hourly-audit", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    if (!scheduledAgentsOn()) return { skipped: "SCHEDULED_AGENTS=off" };
    const sweeps = await step.run("check-open-incidents", async () => {
      const sql = getSql();
      const open = await sql<{ worldId: string; companyId: string; incidentId: string }[]>`
        select i.world_id, i.company_id, i.id as incident_id from incidents i join worlds w on w.id = i.world_id
        where w.kind = 'live' and w.status = 'active' and i.status in ('open', 'contained')`;
      const out: Array<{ name: string; data: Record<string, unknown> }> = [];
      for (const scope of open) {
        const fresh = [];
        for (const flag of await auditChecks(sql, scope.worldId, scope.incidentId)) {
          if (await firstTime(sql, scope, `audit:${flag.key}`)) fresh.push(flag);
        }
        if (fresh.length > 0) out.push({ name: "audit/sweep", data: { ...scope, flags: fresh } });
      }
      return out;
    });
    if (sweeps.length > 0) await step.sendEvent("sweep", sweeps);
    return { incidentsFlagged: sweeps.length };
  },
);

/** Layer 3: the weekly Learning Loop for every live company, Mondays 08:00 at the site. */
const weeklyLearning = inngest.createFunction(
  { id: "weekly-learning-review", triggers: [{ cron: "TZ=America/Toronto 0 8 * * 1" }] },
  async ({ step }) => {
    if (!scheduledAgentsOn()) return { skipped: "SCHEDULED_AGENTS=off" };
    const worlds = await step.run("live-worlds", () => getSql()<{ worldId: string; companyId: string }[]>`select id as world_id, company_id from worlds where kind = 'live' and status = 'active'`);
    if (worlds.length > 0) await step.sendEvent("review", worlds.map((w) => ({ name: "learning/review", data: w })));
    return { companies: worlds.length };
  },
);

export const functions = [
  ...Object.entries(handlers).flatMap(([event, list]) => list.map((h) => handlerFunction(event, h))),
  approvalGate,
  readingWatcher,
  drillAutoplay,
  drillAudit,
  deliverOutbound,
  weeklyExpansionReview,
  hourlyAudit,
  weeklyLearning,
];
