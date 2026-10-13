/**
 * Runs the event chain in-process, without the Inngest dev server: each emitted event is handled
 * in order until none are left. Used by the eval harness.
 *
 * Approval requests either stop the chain (the default, as a real run would wait for a person) or,
 * with `autoApprove`, are approved by an AI seat. The database and recordApproval only allow that
 * in drill worlds.
 */
import { recordApproval } from "@/approvals/record-approval";
import { getSql } from "@/db/client";
import { ApprovalRequested, type Emitted } from "./events";
import { handlers, type StepRunner } from "./handlers";

export interface ProcessedEvent extends Emitted {
  handled: boolean;
}

export interface LocalRunOptions {
  autoApprove?: boolean;
  maxEvents?: number;
}

async function approveAsAiSeat(data: unknown): Promise<Emitted> {
  const req = ApprovalRequested.parse(data);
  const approval = await recordApproval(getSql(), {
    worldId: req.worldId,
    decisionRecordId: req.decisionRecordId,
    seat: req.seat,
    personId: null,
    outcome: "approved",
    reason: "Approved by an AI-played seat (drill).",
  });
  return {
    name: "decision/resolved",
    data: { worldId: req.worldId, companyId: req.companyId, incidentId: req.incidentId, decisionRecordId: req.decisionRecordId, approvalId: approval.approvalId, outcome: "approved" },
  };
}

export async function runLocally(first: Emitted, options: LocalRunOptions = {}): Promise<ProcessedEvent[]> {
  const maxEvents = options.maxEvents ?? 60;
  const run: StepRunner = (_id, fn) => fn();
  const queue: Emitted[] = [first];
  const processed: ProcessedEvent[] = [];
  while (queue.length > 0) {
    if (processed.length >= maxEvents) throw new Error(`Event chain exceeded ${maxEvents} events; possible loop.`);
    const event = queue.shift() as Emitted; // non-empty: checked by the loop condition
    const list = handlers[event.name] ?? [];
    const approvable = event.name === "approval/requested" && options.autoApprove === true;
    processed.push({ ...event, handled: list.length > 0 || approvable });
    if (approvable) queue.push(await approveAsAiSeat(event.data));
    for (const { handle } of list) queue.push(...(await handle(run, event.data)));
  }
  return processed;
}
