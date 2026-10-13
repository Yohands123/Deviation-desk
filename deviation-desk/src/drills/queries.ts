/**
 * Reads for the drill screens. While a drill runs, players never see the hidden spread or which
 * events the saboteurs caused; the facilitator does. Everything is revealed at the debrief.
 */
import "server-only";
import { AgentAnswer } from "@/agents/contract";
import { DrillReviewParams } from "@/agents/action-params";
import { getSql } from "@/db/client";
import type { Viewer } from "@/incident-room/viewer";
import type { DrillScore } from "@/sim/drill-score";
import { loadDrillRun, loadHiddenTruth, milestoneTicks } from "@/sim/drill-state";
import { EFFECT_TARGETS, EFFECT_TYPES } from "@/sim/effects";
import { modeAt, SABOTEUR_INFO, SABOTEURS, type SaboteurMode, type SaboteurName } from "@/sim/modes";
import { REVERSIBLE_WINDOW_TICKS } from "@/sim/drills";
import type { HiddenTruth } from "@/sim/scenario";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface DrillSummary {
  id: string;
  title: string;
  status: "running" | "paused" | "ended";
  tick: number;
  durationTicks: number;
  startedAt: string;
  endedAt: string | null;
  overall: number | null;
  facilitator: string | null;
  incidentCode: string | null;
}

export async function listDrills(viewer: Viewer): Promise<DrillSummary[]> {
  const rows = await getSql()<Array<Omit<DrillSummary, "startedAt" | "endedAt" | "durationTicks"> & { startedAt: Date; endedAt: Date | null; spec: { durationTicks: number } }>>`
    select d.id, s.title, d.status, d.tick, s.spec, d.started_at, d.ended_at, (d.score ->> 'overall')::int as overall,
      p.name as facilitator, i.code as incident_code
    from drill_runs d
    join scenarios s on s.id = d.scenario_id
    left join people p on p.world_id = d.world_id and p.id = d.facilitator_person_id
    left join incidents i on i.world_id = d.world_id and i.id = d.incident_id
    where d.company_id = ${viewer.companyId}
    order by d.status = 'ended', d.started_at desc
    limit 50`;
  return rows.map(({ spec, ...r }) => ({ ...r, durationTicks: spec.durationTicks, startedAt: iso(r.startedAt) ?? "", endedAt: iso(r.endedAt) }));
}

export interface LibraryScenario {
  id: string;
  title: string;
  description: string;
  level: number;
  durationTicks: number;
  trigger: string;
  source: "library" | "builder";
}

export async function listScenarios(viewer: Viewer): Promise<LibraryScenario[]> {
  const rows = await getSql()<Array<{ id: string; title: string; source: "library" | "builder"; spec: { description: string; level: number; durationTicks: number; trigger: { type: string; target: { code: string } } } }>>`
    select id, title, source, spec from scenarios where company_id = ${viewer.companyId} and approved order by source, title`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source,
    description: r.spec.description,
    level: r.spec.level,
    durationTicks: r.spec.durationTicks,
    trigger: `${r.spec.trigger.type.replace(/_/g, " ")} · ${r.spec.trigger.target.code}`,
  }));
}

// ─── Console ─────────────────────────────────────────────────────────

export interface EffectView {
  id: string;
  tick: number;
  /** "Field report" for players; the real actor for the facilitator and at the debrief. */
  actor: string;
  description: string;
  hidden: boolean;
  reversed: boolean;
}

export interface SaboteurView {
  name: SaboteurName;
  label: string;
  behaviour: string;
  mode: SaboteurMode;
  lastAction: string | null;
  /** Room of its latest target, for the voxel world. */
  roomId: string | null;
}

export interface DrillConsole {
  id: string;
  worldId: string;
  title: string;
  description: string;
  status: DrillSummary["status"];
  tick: number;
  durationTicks: number;
  containWithinTicks: number;
  simClock: string;
  difficulty: number;
  secondsPerTick: number;
  agentsEnabled: boolean;
  seed: number;
  isFacilitator: boolean;
  facilitator: string | null;
  incidentCode: string | null;
  mode: SaboteurMode;
  saboteurs: SaboteurView[];
  effects: EffectView[];
  /** Saboteur effects that can be reversed now (only while frightened). */
  reversible: EffectView[];
  /** Facilitator only: how many objects the true contamination has reached. */
  trueSpread: number | null;
  /** Inject targets by table, from the drill's twin. */
  targets: Record<string, string[]>;
  effectTypes: Array<{ type: string; tables: readonly string[] }>;
}

const SABOTEUR_ACTORS = new Set<string>(SABOTEURS);
const actorLabel = (actor: string) =>
  SABOTEUR_ACTORS.has(actor) ? SABOTEUR_INFO[actor as SaboteurName].name : { trigger: "Scenario", twist: "Scenario twist", facilitator: "Facilitator", engine: "Simulation", spread: "True spread", ai_seat: "AI seat" }[actor] ?? actor;

export async function getDrillConsole(viewer: Viewer, drillRunId: string): Promise<DrillConsole | null> {
  const sql = getSql();
  const [owned] = await sql`select 1 from drill_runs where id = ${drillRunId} and company_id = ${viewer.companyId}`;
  if (!owned) return null;
  const run = await loadDrillRun(sql, drillRunId);
  const isFacilitator = run.facilitatorPersonId === viewer.personId;
  const w = run.worldId;

  const rows = await sql<Array<{ id: string; tick: number; actor: string; effectType: string; targetTable: string | null; targetId: string | null; description: string; hidden: boolean; reversed: boolean }>>`
    select e.id::text as id, e.tick, e.actor, e.effect_type, e.target_table, e.target_id::text as target_id, e.description, e.hidden,
      exists (select 1 from sim_effects r where r.world_id = e.world_id and r.reverses_effect_id = e.id) as reversed
    from sim_effects e where e.world_id = ${w} and e.effect_type not in ('tick', 'started')
    order by e.tick desc, e.id desc`;
  const effects = rows
    .filter((e) => isFacilitator || !e.hidden)
    .map((e): EffectView => ({ id: e.id, tick: e.tick, actor: isFacilitator ? actorLabel(e.actor) : SABOTEUR_ACTORS.has(e.actor) ? "Field report" : actorLabel(e.actor), description: e.description, hidden: e.hidden, reversed: e.reversed }));

  const mode = modeAt(run.tick, await milestoneTicks(sql, w));
  const reversible = mode === "frightened"
    ? rows.filter((e) => SABOTEUR_ACTORS.has(e.actor) && !e.reversed && !e.effectType.startsWith("reverse_") && run.tick - e.tick <= REVERSIBLE_WINDOW_TICKS).map((e) => ({ id: e.id, tick: e.tick, actor: actorLabel(e.actor), description: e.description, hidden: false, reversed: false }))
    : [];

  // Where each saboteur last struck, mapped to a room for the voxel world.
  const roomFor = async (table: string | null, id: string | null): Promise<string | null> => {
    if (!table || !id) return null;
    const [r] = await sql<{ roomId: string }[]>`
      select room_id from (
        select id as room_id from rooms where world_id = ${w} and ${table} = 'rooms' and id::text = ${id}
        union all select room_id from equipment where world_id = ${w} and ${table} = 'equipment' and id::text = ${id}
        union all select pl.room_id from batches b join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
          where b.world_id = ${w} and ${table} = 'batches' and b.id::text = ${id}
        union all select id from rooms where world_id = ${w} and ${table} = 'shipments' and room_type = 'shipping'
      ) x limit 1`;
    return r?.roomId ?? null;
  };
  const saboteurs: SaboteurView[] = [];
  for (const name of SABOTEURS) {
    const last = rows.find((e) => e.actor === name && !e.effectType.startsWith("reverse_"));
    saboteurs.push({
      name,
      label: SABOTEUR_INFO[name].name,
      behaviour: SABOTEUR_INFO[name].behaviour,
      mode,
      lastAction: isFacilitator && last ? `Hour ${last.tick}: ${last.description}` : null,
      roomId: last ? await roomFor(last.targetTable, last.targetId) : null,
    });
  }

  const [spread] = await sql<{ n: number }[]>`select count(*)::int as n from sim_effects where world_id = ${w} and effect_type in ('spread_seed', 'spread')`;
  const targetRows = await sql<{ table: string; code: string }[]>`
    select 'rooms' as table, name as code from rooms where world_id = ${w}
    union all select 'batches', batch_code from batches where world_id = ${w}
    union all select 'equipment', name from equipment where world_id = ${w}
    union all select 'shipments', shipment_code from shipments where world_id = ${w}
    order by 1, 2`;
  const targets: Record<string, string[]> = {};
  for (const t of targetRows) (targets[t.table] ??= []).push(t.code);
  const [incident] = await sql<{ code: string }[]>`select code from incidents where world_id = ${w} and id = ${run.incidentId ?? "00000000-0000-0000-0000-000000000000"}`;
  const [fac] = await sql<{ name: string }[]>`select name from people where world_id = ${w} and id = ${run.facilitatorPersonId ?? "00000000-0000-0000-0000-000000000000"}`;

  return {
    id: run.id,
    worldId: w,
    title: run.title,
    description: run.scenario.description,
    status: run.status,
    tick: run.tick,
    durationTicks: run.scenario.durationTicks,
    containWithinTicks: run.scenario.success.containWithinTicks,
    simClock: run.simClock.toISOString(),
    difficulty: run.difficulty,
    secondsPerTick: run.secondsPerTick,
    agentsEnabled: run.agentsEnabled,
    seed: run.seed,
    isFacilitator,
    facilitator: fac?.name ?? null,
    incidentCode: incident?.code ?? null,
    mode,
    saboteurs,
    effects: effects.slice(0, 80),
    reversible,
    trueSpread: isFacilitator ? (spread?.n ?? 0) : null,
    targets,
    effectTypes: EFFECT_TYPES.map((type) => ({ type, tables: EFFECT_TARGETS[type] })),
  };
}

// ─── Debrief ─────────────────────────────────────────────────────────

export interface DrillDebrief {
  console: DrillConsole;
  score: DrillScore;
  hiddenTruth: HiddenTruth;
  /** Everything that happened, attribution and hidden spread included. */
  timeline: EffectView[];
  review: { summary: string; reasoning: string; params: ReturnType<typeof DrillReviewParams.parse> | null; createdAt: string } | null;
  auditRequestedAt: string | null;
}

export async function getDrillDebrief(viewer: Viewer, drillRunId: string): Promise<DrillDebrief | null> {
  const sql = getSql();
  const consoleView = await getDrillConsole(viewer, drillRunId);
  if (!consoleView || consoleView.status !== "ended") return null;
  const run = await loadDrillRun(sql, drillRunId);
  const [row] = await sql<{ score: DrillScore | null; auditRequestedAt: Date | null }[]>`select score, audit_requested_at from drill_runs where id = ${drillRunId}`;
  if (!row?.score) return null;

  const timelineRows = await sql<Array<{ id: string; tick: number; actor: string; description: string; hidden: boolean; reversed: boolean }>>`
    select e.id::text as id, e.tick, e.actor, e.description, e.hidden,
      exists (select 1 from sim_effects r where r.world_id = e.world_id and r.reverses_effect_id = e.id) as reversed
    from sim_effects e where e.world_id = ${run.worldId} and e.effect_type not in ('tick', 'started')
    order by e.tick, e.id`;

  const [reviewRow] = await sql<{ record: { answer: unknown }; createdAt: Date }[]>`
    select record, created_at from decision_records where world_id = ${run.worldId} and agent_id = 'auditor' order by created_at desc limit 1`;
  let review: DrillDebrief["review"] = null;
  if (reviewRow) {
    const a = AgentAnswer.safeParse(reviewRow.record.answer);
    if (a.success) {
      const params = a.data.proposedAction?.type === "record_drill_review" ? DrillReviewParams.safeParse(a.data.proposedAction.params) : null;
      review = { summary: a.data.summary, reasoning: a.data.reasoning, params: params?.success ? params.data : null, createdAt: reviewRow.createdAt.toISOString() };
    }
  }

  return {
    console: consoleView,
    score: row.score,
    hiddenTruth: await loadHiddenTruth(sql, run.scenarioId),
    timeline: timelineRows.map((e) => ({ id: e.id, tick: e.tick, actor: actorLabel(e.actor), description: e.description, hidden: e.hidden, reversed: e.reversed })),
    review,
    auditRequestedAt: iso(row.auditRequestedAt),
  };
}
