/**
 * Writes an agent run and its DecisionRecord to the append-only tables (CLAUDE.md principle 4).
 */
import type { Sql } from "@/db/client";
import type postgres from "postgres";
import type { DecisionRecord } from "./contract";
import type { TokenUsage } from "./models";

export type RunStatus = "ok" | "retried" | "invalid" | "budget_exceeded" | "error";

export interface RunRow {
  worldId: string;
  companyId: string;
  incidentId: string | null;
  agentId: string;
  agentConfigVersion: number | null;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  status: RunStatus;
}

/** Runs outside any incident (orders, planning, learning) share a rolling daily budget per agent. */
export const NO_INCIDENT_DAILY_RUNS = 10;

/**
 * What this agent has spent against its budget, and the budget. On an incident: everything it spent
 * on that incident, against costBudgetUsd. Outside incidents: what it spent in this world in the last
 * 24 hours, against costBudgetUsd × NO_INCIDENT_DAILY_RUNS.
 */
export async function budgetUse(sql: Sql, worldId: string, agentId: string, incidentId: string | null, costBudgetUsd: number): Promise<{ spent: number; limit: number }> {
  const [row] = incidentId
    ? await sql<{ spent: number }[]>`
        select coalesce(sum(cost_usd), 0)::float8 as spent from agent_runs
        where world_id = ${worldId} and agent_id = ${agentId} and incident_id = ${incidentId}`
    : await sql<{ spent: number }[]>`
        select coalesce(sum(cost_usd), 0)::float8 as spent from agent_runs
        where world_id = ${worldId} and agent_id = ${agentId} and incident_id is null and created_at > now() - interval '24 hours'`;
  return { spent: row?.spent ?? 0, limit: incidentId ? costBudgetUsd : costBudgetUsd * NO_INCIDENT_DAILY_RUNS };
}

function runValues(run: RunRow) {
  return {
    worldId: run.worldId,
    companyId: run.companyId,
    incidentId: run.incidentId,
    agentId: run.agentId,
    agentConfigVersion: run.agentConfigVersion,
    model: run.model,
    // Billed input = uncached + cache writes + cache reads.
    inputTokens: run.usage.inputTokens + run.usage.cacheWriteTokens + run.usage.cacheReadTokens,
    outputTokens: run.usage.outputTokens,
    costUsd: run.costUsd.toFixed(4),
    latencyMs: run.latencyMs,
    status: run.status,
  };
}

/** Records a run that produced no decision (the model call failed). */
export async function recordFailedRun(sql: Sql, run: RunRow): Promise<string> {
  const [row] = await sql<{ id: string }[]>`insert into agent_runs ${sql(runValues(run))} returning id`;
  if (!row) throw new Error("Failed to record agent run");
  return row.id;
}

export async function recordRun(
  sql: Sql,
  run: RunRow,
  record: DecisionRecord,
): Promise<{ agentRunId: string; decisionRecordId: string }> {
  return sql.begin(async (tx) => {
    const [runRow] = await tx<{ id: string }[]>`insert into agent_runs ${tx(runValues(run))} returning id`;
    if (!runRow) throw new Error("Failed to record agent run");
    const [decision] = await tx<{ id: string }[]>`
      insert into decision_records ${tx({
        worldId: run.worldId,
        companyId: run.companyId,
        incidentId: run.incidentId,
        agentRunId: runRow.id,
        agentId: run.agentId,
        // DecisionRecord is plain JSON data (validated by Zod before we get here).
        record: tx.json(record as unknown as postgres.JSONValue),
        requiresApproval: record.answer.requiresApproval,
      })}
      returning id`;
    if (!decision) throw new Error("Failed to record decision");
    return { agentRunId: runRow.id, decisionRecordId: decision.id };
  });
}
