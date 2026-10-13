/**
 * Reading a drill's state from the database: its run row, tick timing, team milestones, the hidden
 * spread graph, and what the team is focused on (which the saboteurs use).
 */
import type { Sql } from "@/db/client";
import { traceImpact } from "@/db/trace-impact";
import type { Candidate, SaboteurContext } from "./saboteurs";
import { HiddenTruth, Scenario } from "./scenario";
import type { SaboteurMode } from "./modes";
import type { EdgeKind, SpreadEdge } from "./spread";
import type { TargetTable } from "./effects";

export interface DrillRun {
  id: string;
  worldId: string;
  companyId: string;
  scenarioId: string;
  incidentId: string | null;
  seed: number;
  status: "running" | "paused" | "ended";
  tick: number;
  difficulty: number;
  secondsPerTick: number;
  agentsEnabled: boolean;
  facilitatorPersonId: string | null;
  simClock: Date;
  scenario: Scenario;
  title: string;
}

export async function loadDrillRun(sql: Sql, drillRunId: string): Promise<DrillRun> {
  const [row] = await sql<Array<Omit<DrillRun, "scenario" | "seed"> & { seed: string; spec: unknown }>>`
    select d.id, d.world_id, d.company_id, d.scenario_id, d.incident_id, d.seed, d.status, d.tick, d.difficulty,
      d.seconds_per_tick, d.agents_enabled, d.facilitator_person_id, w.sim_clock, s.spec, s.title
    from drill_runs d join worlds w on w.id = d.world_id join scenarios s on s.id = d.scenario_id
    where d.id = ${drillRunId}`;
  if (!row) throw new Error(`Drill ${drillRunId} not found`);
  const { spec, ...rest } = row;
  return { ...rest, seed: Number(row.seed), scenario: Scenario.parse(spec) };
}

/** The hidden truth. Read only by the simulation engine and, after the drill ends, the Auditor. */
export async function loadHiddenTruth(sql: Sql, scenarioId: string): Promise<HiddenTruth> {
  const [row] = await sql<{ truth: unknown }[]>`select truth from hidden_truths where scenario_id = ${scenarioId}`;
  if (!row) throw new Error("This scenario has no hidden truth.");
  return HiddenTruth.parse(row.truth);
}

export interface TickTime {
  tick: number;
  at: Date;
}

/** When each tick began (from the engine's tick notes), oldest first. */
export async function tickTimes(sql: Sql, worldId: string): Promise<TickTime[]> {
  return sql<TickTime[]>`
    select tick, created_at as at from sim_effects
    where world_id = ${worldId} and effect_type in ('started', 'tick') order by id`;
}

/** The tick that was current at a moment. */
export function tickAt(times: TickTime[], at: Date): number {
  let tick = 0;
  for (const t of times) if (t.at.getTime() <= at.getTime()) tick = t.tick;
  return tick;
}

export async function milestoneTicks(sql: Sql, worldId: string): Promise<number[]> {
  const rows = await sql<{ tick: number }[]>`select tick from sim_effects where world_id = ${worldId} and effect_type = 'milestone'`;
  return rows.map((r) => r.tick);
}

/** Team milestones (approved holds, an accepted root cause) recorded since a moment. */
export async function newMilestones(sql: Sql, worldId: string, since: Date): Promise<Array<{ actionType: string; decisionRecordId: string; at: Date }>> {
  return sql<Array<{ actionType: string; decisionRecordId: string; at: Date }>>`
    select payload ->> 'actionType' as action_type, payload ->> 'decisionRecordId' as decision_record_id, created_at as at
    from incident_events
    where world_id = ${worldId} and event_type = 'decision_recorded' and payload ->> 'outcome' = 'approved'
      and payload ->> 'actionType' in ('hold_batch', 'hold_shipment', 'accept_root_cause') and created_at > ${since}
    order by id`;
}

// ─── Hidden spread ───────────────────────────────────────────────────

const EDGE_KIND: Record<string, EdgeKind> = {
  located_in: "equipment",
  used_equipment: "equipment",
  used_material_lot: "material_lot",
  stocked_as: "shipment",
  shipped_in: "shipment",
  fulfils: "shipment",
  shipped_to: "shipment",
  ordered_for: "shipment",
};

export const nodeKey = (table: string, id: string) => `${table}:${id}`;

export async function spreadGraph(sql: Sql, worldId: string): Promise<{ edges: SpreadEdge[]; contained: Set<string>; labels: Map<string, string> }> {
  const edgeRows = await sql<{ fromTable: string; fromId: string; toTable: string; toId: string; via: string }[]>`
    select from_table, from_id, to_table, to_id, via from impact_edges where world_id = ${worldId}`;
  const edges = edgeRows.flatMap((e): SpreadEdge[] => {
    const kind = EDGE_KIND[e.via];
    return kind ? [{ from: nodeKey(e.fromTable, e.fromId), to: nodeKey(e.toTable, e.toId), kind }] : [];
  });
  const containedRows = await sql<{ key: string }[]>`
    select 'batches:' || id as key from batches where world_id = ${worldId} and status in ('quarantined', 'rejected')
    union all select 'inventory_lots:' || id from inventory_lots where world_id = ${worldId} and on_hold
    union all select 'shipments:' || id from shipments where world_id = ${worldId} and status = 'held'`;
  const labelRows = await sql<{ key: string; label: string }[]>`
    select node_table || ':' || node_id as key, label from twin_nodes where world_id = ${worldId}`;
  return { edges, contained: new Set(containedRows.map((r) => r.key)), labels: new Map(labelRows.map((r) => [r.key, r.label])) };
}

export async function affectedNodes(sql: Sql, worldId: string): Promise<Set<string>> {
  const rows = await sql<{ key: string }[]>`
    select target_table || ':' || target_id as key from sim_effects
    where world_id = ${worldId} and effect_type in ('spread_seed', 'spread') and target_id is not null`;
  return new Set(rows.map((r) => r.key));
}

// ─── What the saboteurs see ──────────────────────────────────────────

const TARGETS = new Set<TargetTable>(["rooms", "batches", "equipment", "shipments"]);

export async function saboteurContext(sql: Sql, worldId: string, tick: number, difficulty: number, mode: SaboteurMode): Promise<SaboteurContext> {
  // Focus: the object the team cites most in its latest records (records count for their subject).
  const cited = await sql<{ table: string; id: string }[]>`
    with recent as (
      select record from decision_records where world_id = ${worldId} order by created_at desc limit 12
    ), sources as (
      select s ->> 'table' as tbl, s ->> 'rowId' as row_id from recent, jsonb_array_elements(record -> 'answer' -> 'sources') s
    )
    select coalesce(r.subject_table, s.tbl) as table, coalesce(r.subject_id::text, s.row_id) as id
    from sources s left join records r on s.tbl = 'records' and r.world_id = ${worldId} and r.id::text = s.row_id`;
  const counts = new Map<string, number>();
  for (const c of cited) if (TARGETS.has(c.table as TargetTable)) counts.set(nodeKey(c.table, c.id), (counts.get(nodeKey(c.table, c.id)) ?? 0) + 1);
  const focusKey = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  const { labels } = await spreadGraph(sql, worldId);
  const candidate = (key: string): Candidate | null => {
    const [table, id] = key.split(":") as [TargetTable, string];
    const label = labels.get(key);
    return label && TARGETS.has(table) ? { table, id, label } : null;
  };
  const focus = focusKey ? candidate(focusKey) : null;

  let focusRoom: Candidate | null = null;
  if (focus?.table === "rooms") focusRoom = focus;
  else if (focus?.table === "equipment" || focus?.table === "batches") {
    // Equipment sits in a room; a batch belongs to its line's room.
    const [room] = await sql<{ id: string; name: string }[]>`
      select r.id, r.name from rooms r
      where r.world_id = ${worldId} and r.id in (
        select room_id from equipment where world_id = ${worldId} and id::text = ${focus.id}
        union
        select pl.room_id from batches b join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
        where b.world_id = ${worldId} and b.id::text = ${focus.id})
      limit 1`;
    focusRoom = room ? { table: "rooms", id: room.id, label: room.name } : null;
  }

  const related: Candidate[] = [];
  if (focus && focus.table !== "rooms") {
    const nodes = await traceImpact(sql, worldId, { table: focus.table, id: focus.id }, 2).catch(() => []);
    for (const n of nodes) {
      if (n.depth === 0 || !(n.table === "batches" || n.table === "equipment")) continue;
      related.push({ table: n.table, id: n.id, label: n.label });
    }
  }

  const shipments = await sql<{ id: string; label: string }[]>`
    select id, shipment_code as label from shipments where world_id = ${worldId} and status in ('planned', 'at_dock') order by shipment_code`;
  const rooms = await sql<{ id: string; label: string }[]>`select id, name as label from rooms where world_id = ${worldId} order by name`;

  return {
    tick,
    difficulty,
    mode,
    focus,
    focusRoom,
    related: related.slice(0, 8),
    plannedShipments: shipments.map((s) => ({ table: "shipments" as const, ...s })),
    quietRooms: rooms.filter((r) => r.id !== focusRoom?.id).map((r) => ({ table: "rooms" as const, ...r })),
  };
}
