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
  model: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  status: RunStatus;
}

/** Cost this agent has already spent on this incident. Runs without an incident are budgeted one at a time. */
export async function spentOnIncident(sql: Sql, worldId: string, agentId: string, incidentId: string | null): Promise<number> {
  if (incidentId === null) return 0;
  const [row] = await sql<{ spent: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as spent from agent_runs
    where world_id = ${worldId} and agent_id = ${agentId} and incident_id = ${incidentId}`;
  return row?.spent ?? 0;
}

function runValues(run: RunRow) {
  return {
    worldId: run.worldId,
    companyId: run.companyId,
    incidentId: run.incidentId,
    agentId: run.agentId,
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
