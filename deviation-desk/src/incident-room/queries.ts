/**
 * Reads for the Incident Room. Everything is scoped to the viewer's world; ids from the browser
 * are only ever looked up inside it.
 */
import "server-only";
import { APPROVING_SEATS } from "@/agents/approvals";
import { AgentAnswer, type SeatRole } from "@/agents/contract";
import { defaultAgents } from "@/agents/registry";
import { CITABLE_TABLES } from "@/agents/verify-sources";
import { getSql, type Sql } from "@/db/client";
import { GraphTable } from "@/db/rows";
import { traceImpact } from "@/db/trace-impact";
import { hoursLeft, worldNow } from "@/regulatory/deadlines";
import { roomLookup, type RoomsOf } from "./room-lookup";
import { buildSceneData } from "./scene-data";
import {
  LIVE_SEATS,
  SEAT_LABELS,
  type AgentCard,
  type ConflictItem,
  type EvidenceItem,
  type IncidentRoomView,
  type IncidentSummary,
  type MapRoom,
  type MessageStatus,
  type MessageView,
  type ObligationView,
  type SeatView,
  type Severity,
} from "./types";
import type { Viewer } from "./viewer";
import {
  actionLabel,
  decisionStatus,
  describeEvent,
  feedFromCards,
  isOpen,
  mergeFeed,
  pendingFor,
  roomTint,
  type ApprovalRow,
  type EventRow,
} from "./view-model";

const AGENT_NAMES = new Map(defaultAgents.map((a) => [a.id, a.name]));
const AGENT_SEATS = new Map(defaultAgents.map((a) => [a.id, a.seat]));
const iso = (d: Date) => d.toISOString();

interface IncidentRow {
  id: string;
  code: string;
  title: string;
  incidentType: string;
  severity: Severity;
  status: string;
  openedAt: Date;
  pendingDecisions: number;
}

const toSummary = (r: IncidentRow): IncidentSummary => ({ ...r, openedAt: iso(r.openedAt) });

export async function listIncidents(viewer: Viewer): Promise<IncidentSummary[]> {
  const rows = await getSql()<IncidentRow[]>`
    select i.id, i.code, i.title, i.incident_type, i.severity, i.status, i.opened_at,
      (select count(*) from decision_records d
        where d.world_id = i.world_id and d.incident_id = i.id and d.requires_approval
          and not exists (select 1 from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id
            and a.outcome in ('approved', 'rejected', 'override')))::int as pending_decisions
    from incidents i
    where i.world_id = ${viewer.worldId}
    order by i.status = 'closed', i.opened_at desc`;
  return rows.map(toSummary);
}

// ─── Cards ───────────────────────────────────────────────────────────

async function loadCards(sql: Sql, worldId: string, incidentId: string, extraIds: string[]): Promise<AgentCard[]> {
  const records = await sql<{ id: string; agentId: string; record: { answer: unknown; rejectedSources?: unknown[] }; createdAt: Date }[]>`
    select id, agent_id, record, created_at from decision_records
    where world_id = ${worldId} and (incident_id = ${incidentId} or id::text in ${sql(extraIds.length ? extraIds : ["-"])})
    order by created_at`;
  const approvals = await sql<Array<Omit<ApprovalRow, "at"> & { at: Date }>>`
    select a.decision_record_id, a.outcome, a.seat, p.name as by, a.reason, a.created_at as at
    from approvals a left join people p on p.world_id = a.world_id and p.id = a.person_id
    where a.world_id = ${worldId} and a.decision_record_id in ${sql(records.length ? records.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"])}
    order by a.created_at`;

  return records.flatMap((r): AgentCard[] => {
    const parsed = AgentAnswer.safeParse(r.record.answer);
    if (!parsed.success) return [];
    const a = parsed.data;
    const mine = approvals.filter((x) => x.decisionRecordId === r.id).map((x) => ({ ...x, at: iso(x.at) }));
    const { status, decision } = decisionStatus(a.requiresApproval, mine);
    return [
      {
        decisionRecordId: r.id,
        agentId: r.agentId,
        agentName: AGENT_NAMES.get(r.agentId) ?? r.agentId,
        createdAt: iso(r.createdAt),
        kind: a.kind,
        summary: a.summary,
        reasoning: a.reasoning,
        confidence: a.confidence,
        confidenceScore: a.confidenceScore ?? null,
        sources: a.sources,
        alternatives: a.alternatives,
        requiresApproval: a.requiresApproval,
        approvalSeat: a.approvalSeat ?? null,
        decidingSeats: a.proposedAction ? [...(APPROVING_SEATS[a.proposedAction.type] ?? [])] : [],
        action: a.proposedAction ? { type: a.proposedAction.type, label: actionLabel(a.proposedAction.type), params: a.proposedAction.params } : null,
        status,
        decision: decision ? { seat: decision.seat, by: decision.by, reason: decision.reason, at: decision.at } : null,
        rejectedSourceCount: r.record.rejectedSources?.length ?? 0,
        advisories: [],
      },
    ];
  });
}

/** Attaches Regulator A's advisories (incident events link them) to the proposals they review. */
function attachAdvisories(cards: AgentCard[], events: Array<Pick<EventRow, "eventType" | "payload">>): void {
  const byId = new Map(cards.map((c) => [c.decisionRecordId, c]));
  for (const e of events) {
    if (e.eventType !== "advisory_added") continue;
    const target = byId.get(String(e.payload.reviewsDecisionId));
    const advisory = byId.get(String(e.payload.advisoryDecisionId));
    if (!target || !advisory) continue;
    target.advisories.push({ decisionRecordId: advisory.decisionRecordId, agentName: advisory.agentName, summary: advisory.summary, reasoning: advisory.reasoning });
  }
}

/** Confirmed obligations with their deadlines in the world's clock, and every approved message. */
async function loadRegulatory(sql: Sql, worldId: string, incidentId: string): Promise<IncidentRoomView["regulatory"]> {
  const messages = await sql<Array<Omit<MessageView, "label" | "to" | "createdAt"> & { recipients: Array<{ name: string }>; createdAt: Date }>>`
    select id, action_type, audience, recipients, subject, body, status, last_error, created_at
    from outbound_messages where world_id = ${worldId} and incident_id = ${incidentId} order by created_at`;
  const rows = await sql<
    Array<{ id: string; ruleCode: string; title: string; authority: string; fictional: boolean; clockStartedAt: Date; dueAt: Date; status: MessageStatus | null; subject: string | null }>
  >`
    select o.id, r.code as rule_code, r.title, r.authority, r.fictional, o.clock_started_at, o.due_at, m.status, m.subject
    from regulatory_obligations o
    join regulatory_rules r on r.world_id = o.world_id and r.id = o.rule_id
    left join outbound_messages m on m.world_id = o.world_id and m.id = o.submitted_message_id
    where o.world_id = ${worldId} and o.incident_id = ${incidentId}
    order by o.due_at`;
  const now = rows.length > 0 ? await worldNow(sql, worldId) : new Date();
  const obligations: ObligationView[] = rows.map(({ status, subject, ...o }) => ({
    ...o,
    clockStartedAt: iso(o.clockStartedAt),
    dueAt: iso(o.dueAt),
    hoursLeft: hoursLeft(o.dueAt, now),
    submission: status && subject ? { status, subject } : null,
  }));
  return {
    obligations,
    messages: messages.map(({ recipients, createdAt, ...m }) => ({ ...m, label: actionLabel(m.actionType), to: recipients.map((r) => r.name), createdAt: iso(createdAt) })),
  };
}

// ─── Flat map ────────────────────────────────────────────────────────

interface ObjectRef {
  table: string;
  code: string;
  id: string | null;
}

async function buildMap(sql: Sql, worldId: string, objects: ObjectRef[], roomsOf: RoomsOf): Promise<{ map: MapRoom[]; spreadPaths: string[] }> {
  const rooms = await sql<{ id: string; name: string; department: string; status: string; layout: { x: number; y: number; w: number; d: number } | null }[]>`
    select id, name, department, status, layout from rooms where world_id = ${worldId} order by name`;
  const critical = new Map<string, string[]>();
  const atRisk = new Map<string, string[]>();
  const note = (m: Map<string, string[]>, roomId: string, why: string) => m.set(roomId, [...(m.get(roomId) ?? []), why]);
  const paths = new Set<string>();

  for (const o of objects) {
    if (!o.id) continue;
    for (const roomId of roomsOf(o.table, o.id)) note(critical, roomId, `Incident object: ${o.code}`);
    const start = GraphTable.safeParse(o.table);
    if (!start.success) continue;
    const nodes = await traceImpact(sql, worldId, { table: start.data, id: o.id }, 2).catch(() => []);
    const labels = new Map(nodes.map((n) => [`${n.table}:${n.id}`, n.label]));
    for (const n of nodes) {
      if (n.depth === 0) continue;
      for (const roomId of roomsOf(n.table, n.id)) note(atRisk, roomId, `Connected: ${n.label}`);
      if (n.depth === 2 && ["batches", "shipments"].includes(n.table)) {
        paths.add(n.path.map((p) => labels.get(`${p.table}:${p.id}`) ?? "?").join(" → "));
      }
    }
  }

  const map = rooms.flatMap((r): MapRoom[] => {
    if (!r.layout) return [];
    const reasons = [...new Set([...(critical.get(r.id) ?? []), ...(atRisk.get(r.id) ?? [])])].slice(0, 4);
    return [{ id: r.id, name: r.name, department: r.department, ...r.layout, tint: roomTint(r.status, critical.has(r.id), atRisk.has(r.id)), reasons }];
  });
  return { map, spreadPaths: [...paths].slice(0, 8) };
}

// ─── The room ────────────────────────────────────────────────────────

export async function getIncidentRoom(
  viewer: Viewer,
  code: string,
  /** Seats on offer: the live seats, plus the facilitator in a drill. */
  seatRoles: readonly SeatRole[] = LIVE_SEATS,
): Promise<IncidentRoomView | null> {
  const sql = getSql();
  const [incident] = await sql<IncidentRow[]>`
    select id, code, title, incident_type, severity, status, opened_at, 0 as pending_decisions
    from incidents where world_id = ${viewer.worldId} and code = ${code}`;
  if (!incident) return null;
  const w = viewer.worldId;

  const events = (
    await sql<Array<Omit<EventRow, "at"> & { at: Date }>>`
      select id::text as id, created_at as at, actor_type, actor_id, seat, event_type, payload
      from incident_events where world_id = ${w} and incident_id = ${incident.id} order by id`
  ).map((e) => ({ ...e, at: iso(e.at) }));
  const opened = events.find((e) => e.eventType === "opened");
  const objects = (Array.isArray(opened?.payload.objects) ? opened.payload.objects : []) as ObjectRef[];
  const triageId = typeof opened?.payload.triageDecisionId === "string" ? opened.payload.triageDecisionId : null;

  const cards = await loadCards(sql, w, incident.id, triageId ? [triageId] : []);
  attachAdvisories(cards, events);
  const people = await sql<{ id: string; name: string }[]>`select id, name from people where world_id = ${w}`;
  const personName = new Map(people.map((p) => [p.id, p.name]));

  const seatRows = await sql<{ role: SeatRole; personId: string | null }[]>`
    select role, person_id from seats where world_id = ${w} and incident_id = ${incident.id}`;
  const ranAgents = new Set(cards.map((c) => c.agentId));
  const seats: SeatView[] = seatRoles.map((role) => {
    const holderId = seatRows.find((s) => s.role === role)?.personId ?? null;
    return {
      role,
      label: SEAT_LABELS[role],
      holder: holderId ? { personId: holderId, name: personName.get(holderId) ?? "Unknown" } : null,
      agents: [...ranAgents].filter((id) => AGENT_SEATS.get(id) === role).map((id) => AGENT_NAMES.get(id) ?? id),
      pendingDecisions: cards.filter((c) => isOpen(c) && c.decidingSeats.includes(role)).length,
    };
  });
  // A drill facilitator can also play a seat; the playing seat is the one they work from.
  const held = seats.filter((s) => s.holder?.personId === viewer.personId);
  const mySeat = (held.find((s) => s.role !== "facilitator") ?? held[0])?.role ?? null;

  const evidenceRows = await sql<{ id: string; sourceTable: string; sourceId: string | null; note: string; addedByType: "agent" | "human"; addedBy: string; createdAt: Date }[]>`
    select id, source_table, source_id, note, added_by_type, added_by, created_at
    from evidence where world_id = ${w} and incident_id = ${incident.id} order by created_at`;
  const evidence: EvidenceItem[] = evidenceRows
    // The collector's own decision record is evidence for agents; people see the card instead.
    .filter((e) => e.sourceTable !== "decision_records")
    .map((e) => ({
      ...e,
      addedBy: e.addedByType === "human" ? (personName.get(e.addedBy) ?? "Someone") : (AGENT_NAMES.get(e.addedBy) ?? e.addedBy),
      createdAt: iso(e.createdAt),
    }));

  const names = { people: personName, agents: AGENT_NAMES };
  const feed = mergeFeed(
    events.flatMap((e) => {
      const item = describeEvent(e, names);
      return item ? [item] : [];
    }),
    feedFromCards(cards),
  );

  const resolved = new Map(
    events.filter((e) => e.eventType === "conflict_resolved").map((e) => [String(e.payload.conflictId), e]),
  );
  const conflicts: ConflictItem[] = events
    .filter((e) => e.eventType === "conflict_raised")
    .map((e) => {
      const r = resolved.get(e.id);
      return {
        id: e.id,
        at: e.at,
        raisedBy: personName.get(e.actorId) ?? "Someone",
        fromSeat: e.seat ?? "observer",
        withSeat: (e.payload.withSeat as SeatRole) ?? "executive",
        summary: String(e.payload.summary ?? ""),
        resolution: r ? { by: personName.get(r.actorId) ?? "Someone", note: String(r.payload.note ?? ""), at: r.at } : null,
        votes: events
          .filter((v) => v.eventType === "council_vote" && String(v.payload.conflictId) === e.id)
          .map((v) => ({
            member: AGENT_NAMES.get(v.actorId) ?? v.actorId,
            favors: (["raising_seat", "other_seat"].includes(String(v.payload.favors)) ? v.payload.favors : "neither") as ConflictItem["votes"][number]["favors"],
            position: String(v.payload.position ?? ""),
            decisionRecordId: String(v.payload.decisionRecordId ?? ""),
          })),
      };
    });
  const lastPause = incident.status === "paused" ? events.filter((e) => e.eventType === "paused").at(-1) : undefined;

  const roomsOf = await roomLookup(sql, w);
  const { map, spreadPaths } = await buildMap(sql, w, objects, roomsOf);
  const pendingForMe = pendingFor(mySeat, cards);
  const scene = await buildSceneData(sql, w, { map, cards, seats, mySeat }, roomsOf);
  const regulatory = await loadRegulatory(sql, w, incident.id);
  return {
    incident: toSummary({ ...incident, pendingDecisions: cards.filter(isOpen).length }),
    objects: objects.map(({ table, code: c }) => ({ table, code: c })),
    seats,
    mySeat,
    cards,
    pendingForMe,
    feed,
    evidence,
    map,
    spreadPaths,
    conflicts,
    paused: lastPause ? { reason: String(lastPause.payload.reason ?? ""), at: lastPause.at } : incident.status === "paused" ? { reason: "", at: iso(incident.openedAt) } : null,
    regulatory,
    scene,
  };
}

// ─── Source records ──────────────────────────────────────────────────

export interface SourceRecord {
  table: string;
  rowId: string;
  fields: Array<{ name: string; value: string }>;
}

const HIDDEN_FIELDS = new Set(["world_id", "company_id", "embedding", "layout", "auth_user_id"]);

/** One cited row, for the source drawer. Only citable tables, only the viewer's world. */
export async function getSourceRecord(viewer: Viewer, table: string, rowId: string): Promise<SourceRecord | null> {
  if (!CITABLE_TABLES.has(table)) return null;
  const sql = getSql();
  const [row] = await sql<{ row: Record<string, unknown> }[]>`
    select to_jsonb(t) as row from ${sql(table)} t where t.world_id = ${viewer.worldId} and t.id::text = ${rowId}`;
  if (!row) return null;
  const fields = Object.entries(row.row)
    .filter(([name, value]) => !HIDDEN_FIELDS.has(name) && value !== null)
    .map(([name, value]) => ({ name: name.replace(/_/g, " "), value: typeof value === "string" ? value : JSON.stringify(value) }));
  return { table, rowId, fields };
}
