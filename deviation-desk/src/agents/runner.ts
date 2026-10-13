/**
 * Generic agent runner. One code path for every agent (CLAUDE.md §7.3):
 * budget check → tool loop (agent-loop.ts) → source verification → append-only records.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSql, type Sql } from "@/db/client";
import { AgentLoopError, runAgentLoop, type CreateMessage, type LoopResult } from "./agent-loop";
import { DecisionRecord, type AgentAnswer, type AgentConfig } from "./contract";
import { modelFor } from "./models";
import { recordFailedRun, recordRun, spentOnIncident, type RunRow } from "./persist";
import { tools as allTools } from "./tools";
import type { AgentTool, ToolContext } from "./tools/types";
import { verifySources } from "./verify-sources";

export interface RunInput {
  agent: AgentConfig;
  ctx: ToolContext;
  /** Short task for this run, e.g. "Incident DEV-0001 opened: sterility failure on batch A-2231". */
  task: string;
  /** Untrusted text (user reports, documents). Always wrapped, never trusted. */
  untrusted?: string[];
  /** The agent_configs version this config came from, recorded on the run. */
  agentVersion?: number;
}

export interface RunnerDeps {
  sql?: Sql;
  createMessage?: CreateMessage;
  tools?: Readonly<Record<string, AgentTool>>;
}

export interface RunResult {
  record: DecisionRecord;
  decisionRecordId: string;
  agentRunId: string;
  status: LoopResult["status"];
  costUsd: number;
  usage: LoopResult["usage"];
  toolCalls: number;
  latencyMs: number;
}

let client: Anthropic | undefined;
/** Created on first use so importing this module never needs an API key (e.g. during next build). */
const defaultCreateMessage: CreateMessage = (params) => {
  client ??= new Anthropic();
  return client.beta.messages.create(params);
};

/** Drops sources that are not real rows; an answer left with none can no longer stand as a finding. */
async function checkSources(sql: Sql, worldId: string, answer: AgentAnswer) {
  const { kept, rejected } = await verifySources(sql, worldId, answer.sources);
  if (rejected.length === 0) return { answer, rejected };
  if (kept.length === 0 && answer.kind !== "insufficient_evidence") {
    return {
      rejected,
      answer: {
        ...answer,
        kind: "insufficient_evidence" as const,
        sources: [],
        confidence: "insufficient" as const,
        requiresApproval: false,
        approvalSeat: undefined,
        proposedAction: undefined,
        reasoning: `None of the cited sources exist in this world, so this answer cannot stand. Original summary: ${answer.summary}`.slice(0, 2000),
      },
    };
  }
  return { answer: { ...answer, sources: kept }, rejected };
}

export async function runAgent(input: RunInput, deps: RunnerDeps = {}): Promise<RunResult> {
  const sql = deps.sql ?? getSql();
  const { agent, ctx } = input;
  const base = { worldId: ctx.worldId, companyId: ctx.companyId, incidentId: ctx.incidentId, agentId: agent.id };

  const remaining = agent.costBudgetUsd - (await spentOnIncident(sql, ctx.worldId, agent.id, ctx.incidentId));

  let loop: LoopResult;
  if (remaining <= 0) {
    loop = {
      status: "budget_exceeded",
      model: modelFor(agent.modelTier),
      usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      costUsd: 0,
      toolCalls: 0,
      latencyMs: 0,
      validationErrors: [],
      answer: {
        kind: "insufficient_evidence",
        summary: `${agent.name} did not run: its cost budget for this incident is used up.`,
        reasoning: `Budget $${agent.costBudgetUsd.toFixed(2)} per incident. A person can raise it or proceed without this agent.`,
        sources: [],
        confidence: "insufficient",
        alternatives: [],
        requiresApproval: false,
      },
    };
  } else {
    try {
      loop = await runAgentLoop({
        ...input,
        tools: deps.tools ?? allTools,
        createMessage: deps.createMessage ?? defaultCreateMessage,
        budgetUsd: remaining,
        findInvalidSources: async (sources) => (await verifySources(sql, ctx.worldId, sources)).rejected,
      });
    } catch (err) {
      if (err instanceof AgentLoopError) {
        await recordFailedRun(sql, { ...base, ...err.spent, agentConfigVersion: input.agentVersion ?? null, status: "error" });
      }
      throw err;
    }
  }

  // Surface validation trouble in logs; the record itself only keeps the final answer.
  for (const error of loop.validationErrors) console.warn(`[agent ${agent.id}] answer failed validation: ${error}`);

  const { answer, rejected } = await checkSources(sql, ctx.worldId, loop.answer);
  const record = DecisionRecord.parse({ ...base, answer, rejectedSources: rejected });
  const run: RunRow = { ...base, agentConfigVersion: input.agentVersion ?? null, model: loop.model, usage: loop.usage, costUsd: loop.costUsd, latencyMs: loop.latencyMs, status: loop.status };
  const ids = await recordRun(sql, run, record);

  return {
    record,
    ...ids,
    status: loop.status,
    costUsd: loop.costUsd,
    usage: loop.usage,
    toolCalls: loop.toolCalls,
    latencyMs: loop.latencyMs,
  };
}
