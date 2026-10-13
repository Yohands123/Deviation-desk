/**
 * The Auditor's hourly sweep, Layer 1 first (CLAUDE.md §8): rule checks in code find gaps on open
 * incidents; the Auditor agent is called only when a check finds something new, so a quiet hour
 * costs nothing.
 */
import type { Sql } from "@/db/client";
import { hoursLeft, worldNow } from "@/regulatory/deadlines";

export interface AuditFlag {
  /** Stable key, so the same gap is raised once. */
  key: string;
  text: string;
}

const HOUR_MS = 3_600_000;

export async function auditChecks(sql: Sql, worldId: string, incidentId: string): Promise<AuditFlag[]> {
  const now = await worldNow(sql, worldId);
  const flags: AuditFlag[] = [];

  const [incident] = await sql<{ code: string; severity: string; openedAt: Date }[]>`
    select code, severity, opened_at from incidents where world_id = ${worldId} and id = ${incidentId}`;
  if (!incident) return [];

  const unowned = await sql<{ id: string; title: string }[]>`
    select id, title from tasks where world_id = ${worldId} and incident_id = ${incidentId} and status = 'open' and owner_seat is null`;
  for (const t of unowned) flags.push({ key: `unowned-task:${t.id}`, text: `Task "${t.title}" has no owner seat.` });

  const overdue = await sql<{ id: string; title: string; ownerSeat: string | null; dueAt: Date }[]>`
    select id, title, owner_seat, due_at from tasks
    where world_id = ${worldId} and incident_id = ${incidentId} and status = 'open' and due_at < ${now}`;
  for (const t of overdue) flags.push({ key: `overdue-task:${t.id}`, text: `Task "${t.title}" (${t.ownerSeat ?? "no owner"}) was due ${t.dueAt.toISOString()} and is still open.` });

  if (incident.severity === "critical" && now.getTime() - incident.openedAt.getTime() > HOUR_MS) {
    const [qa] = await sql`select 1 from seats where world_id = ${worldId} and incident_id = ${incidentId} and role = 'qa_director' and person_id is not null`;
    if (!qa) flags.push({ key: "no-qa-director", text: `Critical incident ${incident.code} has been open over an hour with no person in the QA Director seat.` });
  }

  const obligations = await sql<{ id: string; code: string; dueAt: Date }[]>`
    select o.id, r.code, o.due_at from regulatory_obligations o join regulatory_rules r on r.world_id = o.world_id and r.id = o.rule_id
    where o.world_id = ${worldId} and o.incident_id = ${incidentId} and o.submitted_message_id is null`;
  for (const o of obligations) {
    const left = hoursLeft(o.dueAt, now);
    if (left < 12) flags.push({ key: `obligation-due:${o.id}`, text: `Reporting obligation ${o.code} is due in ${left} h with no approved submission.` });
  }

  const [overdueDecisions] = await sql<{ n: number }[]>`
    select count(*)::int as n from incident_events where world_id = ${worldId} and incident_id = ${incidentId} and event_type = 'approval_overdue'`;
  if ((overdueDecisions?.n ?? 0) > 0) flags.push({ key: `overdue-decisions:${overdueDecisions?.n}`, text: `${overdueDecisions?.n} decision(s) on this incident are overdue.` });

  return flags;
}
