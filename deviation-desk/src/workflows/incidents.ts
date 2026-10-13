/**
 * Incident bookkeeping done by workflows (not agents): opening incidents from triage proposals,
 * recording timeline events, and reading which agents the Dispatcher activated.
 */
import type postgres from "postgres";
import type { Sql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import type { z } from "zod";
import type { OpenIncidentParams } from "@/agents/action-params";

const PRIORITY: Record<z.infer<typeof OpenIncidentParams>["severity"], number> = {
  critical: 90,
  warning: 70,
  watch: 50,
  info: 30,
};

/** Payloads here are built from plain JSON values (strings, arrays, nulls). */
const asJson = (value: Record<string, unknown>) => value as postgres.JSONValue;

interface Scope {
  worldId: string;
  companyId: string;
}

export async function addIncidentEvent(
  sql: Sql,
  scope: Scope & { incidentId: string },
  event: { actorType: "agent" | "human" | "system"; actorId: string; eventType: string; payload: Record<string, unknown> },
): Promise<void> {
  // Pick the scope fields explicitly: callers often pass a whole event payload as the scope.
  const { worldId, companyId, incidentId } = scope;
  await sql`insert into incident_events ${sql({ worldId, companyId, incidentId, ...event, payload: sql.json(asJson(event.payload)) })}`;
}

/**
 * Opens an incident from an Intake Triage proposal. Opening is internal tracking, not one of the
 * consequential actions in principle 1, so it needs no approval; the opened event links back to
 * the triage decision that proposed it.
 */
export async function openIncident(
  sql: Sql,
  scope: Scope,
  params: z.infer<typeof OpenIncidentParams>,
  /** The triage decision that proposed it; null when a drill opens its own incident. */
  triageDecisionId: string | null,
): Promise<{ incidentId: string; code: string }> {
  const objects = await Promise.all(
    params.objects.map(async (o) => ({
      ...o,
      id: await resolveRef(sql, scope.worldId, o).catch(() => null),
    })),
  );

  return sql.begin(async (tx) => {
    // Serialize code allocation per world so two incidents never get the same code.
    await tx`select pg_advisory_xact_lock(hashtext(${`incident-code:${scope.worldId}`}))`;
    const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`
      select count(*)::int as n from incidents where world_id = ${scope.worldId}`;
    const code = `DEV-${String(n + 1).padStart(4, "0")}`;
    const [incident] = await tx<{ id: string }[]>`
      insert into incidents ${tx({
        ...scope,
        code,
        title: params.title,
        incidentType: params.incidentType,
        severity: params.severity,
        priority: PRIORITY[params.severity],
      })}
      returning id`;
    if (!incident) throw new Error("Failed to open incident");
    await tx`insert into incident_events ${tx({
      ...scope,
      incidentId: incident.id,
      actorType: "system",
      actorId: "workflow",
      eventType: "opened",
      payload: tx.json(asJson({ objects, triageDecisionId })),
    })}`;
    return { incidentId: incident.id, code };
  });
}

/** Agents the Dispatcher activated for this incident (latest activation wins). */
export async function activatedAgents(sql: Sql, worldId: string, incidentId: string): Promise<string[]> {
  const [row] = await sql<{ agents: string[] | null }[]>`
    select payload -> 'agents' as agents from incident_events
    where world_id = ${worldId} and incident_id = ${incidentId} and event_type = 'agents_activated'
    order by id desc limit 1`;
  return row?.agents ?? [];
}

/** A one-paragraph description of the incident for agent tasks. */
export async function describeIncident(sql: Sql, worldId: string, incidentId: string): Promise<string> {
  const [incident] = await sql<{ code: string; title: string; incidentType: string; severity: string }[]>`
    select code, title, incident_type, severity from incidents where world_id = ${worldId} and id = ${incidentId}`;
  if (!incident) throw new Error(`Incident ${incidentId} not found in world ${worldId}`);
  const [opened] = await sql<{ objects: Array<{ table: string; code: string }> | null; triageSummary: string | null }[]>`
    select e.payload -> 'objects' as objects, d.record -> 'answer' ->> 'summary' as triage_summary
    from incident_events e
    left join decision_records d on d.world_id = e.world_id and d.id::text = e.payload ->> 'triageDecisionId'
    where e.world_id = ${worldId} and e.incident_id = ${incidentId} and e.event_type = 'opened'
    order by e.id limit 1`;
  const objects = (opened?.objects ?? []).map((o) => `${o.table} ${o.code}`).join(", ") || "none recorded";
  const triage = opened?.triageSummary ? ` Triage: ${opened.triageSummary}` : "";
  return `Incident ${incident.code} (${incident.incidentType}, ${incident.severity}): ${incident.title}. Objects: ${objects}.${triage}`;
}

export async function incidentSeverity(sql: Sql, worldId: string, incidentId: string): Promise<"info" | "watch" | "warning" | "critical"> {
  const [row] = await sql<{ severity: "info" | "watch" | "warning" | "critical" }[]>`
    select severity from incidents where world_id = ${worldId} and id = ${incidentId}`;
  if (!row) throw new Error(`Incident ${incidentId} not found in world ${worldId}`);
  return row.severity;
}

/** Records that an event already led to an action for this incident, so it is not repeated. */
export async function firstTime(sql: Sql, scope: { worldId: string; companyId: string; incidentId: string }, key: string): Promise<boolean> {
  const [seen] = await sql`
    select 1 from incident_events
    where world_id = ${scope.worldId} and incident_id = ${scope.incidentId} and event_type = 'dedupe' and payload ->> 'key' = ${key}`;
  if (seen) return false;
  await addIncidentEvent(sql, scope, { actorType: "system", actorId: "workflow", eventType: "dedupe", payload: { key } });
  return true;
}

/** A paused incident's agent work waits until a person resumes it (the Coordinator proposes pauses). */
export async function isPaused(sql: Sql, worldId: string, incidentId: string): Promise<boolean> {
  const [row] = await sql<{ status: string }[]>`select status from incidents where world_id = ${worldId} and id = ${incidentId}`;
  return row?.status === "paused";
}

/**
 * Events whose handlers run even while their incident is paused: carrying out a decision a person
 * already made, and the resume itself.
 */
export const RUNS_WHILE_PAUSED = new Set(["decision/resolved", "incident/resumed"]);

