/**
 * Building blocks shared by the event handlers: run an agent as a durable step, request a human
 * decision for a proposal, and check whether the Dispatcher activated an agent.
 */
import "server-only";
import { loadAgent } from "@/agents/configs";
import type { AgentAnswer, ModelTier } from "@/agents/contract";
import { runAgent } from "@/agents/runner";
import { getSql, type Sql } from "@/db/client";
import { activeLessons, lessonsBlock } from "@/learning/lessons";
import type { Emitted } from "./events";
import { activatedAgents, addIncidentEvent, incidentSeverity } from "./incidents";

export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;
export type Handler = (run: StepRunner, data: unknown) => Promise<Emitted[]>;
export interface NamedHandler {
  id: string;
  handle: Handler;
}

// Type aliases (not interfaces) so they can be used directly as event payloads.
export type Scope = {
  worldId: string;
  companyId: string;
};
export type IncidentScope = Scope & {
  incidentId: string;
};
export interface Decision {
  decisionRecordId: string;
  answer: AgentAnswer;
}

export const sqlFor = (): Sql => getSql();

export interface DecideOptions {
  /** Run on a cheaper tier than the agent's default (e.g. the Auditor's hourly sweep). */
  tier?: ModelTier;
}

export async function decide(
  sql: Sql,
  agentId: string,
  scope: Scope & { incidentId: string | null },
  task: string,
  untrusted?: string[],
  options: DecideOptions = {},
): Promise<Decision> {
  const { config, version } = await loadAgent(sql, agentId);
  // Lessons people approved for this company sit beside the reviewed prompt (src/learning).
  const lessons = await activeLessons(sql, scope.companyId, agentId);
  const agent = {
    ...config,
    modelTier: options.tier ?? config.modelTier,
    systemPrompt: lessons.length > 0 ? `${config.systemPrompt}

${lessonsBlock(lessons)}` : config.systemPrompt,
  };
  const result = await runAgent({ agent, agentVersion: version, ctx: { ...scope, agentId }, task, untrusted });
  return { decisionRecordId: result.decisionRecordId, answer: result.record.answer };
}

/** When a decision needs a human, records the request and returns the event the approval gate waits on. */
export async function approvalRequest(run: StepRunner, sql: Sql, scope: IncidentScope, decision: Decision, stepId: string): Promise<Emitted[]> {
  const { answer } = decision;
  if (!answer.requiresApproval || !answer.approvalSeat || !answer.proposedAction) return [];
  const { approvalSeat: seat, proposedAction } = answer;
  const severity = await run(`${stepId}-request-approval`, async () => {
    await addIncidentEvent(sql, scope, {
      actorType: "system",
      actorId: "workflow",
      eventType: "approval_requested",
      payload: { decisionRecordId: decision.decisionRecordId, seat, actionType: proposedAction.type },
    });
    return incidentSeverity(sql, scope.worldId, scope.incidentId);
  });
  return [
    {
      name: "approval/requested",
      data: { ...scope, decisionRecordId: decision.decisionRecordId, seat, actionType: proposedAction.type, severity },
    },
  ];
}

export const isActive = async (run: StepRunner, sql: Sql, scope: IncidentScope, agentId: string, stepId: string) =>
  (await run(stepId, () => activatedAgents(sql, scope.worldId, scope.incidentId))).includes(agentId);

export const incidentScope = (e: IncidentScope): IncidentScope => ({ worldId: e.worldId, companyId: e.companyId, incidentId: e.incidentId });
