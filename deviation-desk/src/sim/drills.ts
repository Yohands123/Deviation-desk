/**
 * Drill lifecycle (CLAUDE.md §9): start from an approved scenario, play / pause / step, facilitator
 * injections and reversals, end and score. All drill state lives in its own world; nothing here
 * writes to a live world.
 */
import { randomInt } from "node:crypto";
import { AgentAnswer } from "@/agents/contract";
import { takeSeat } from "@/approvals/seats";
import type { Sql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { worldClock } from "@/db/inventory";
import type { Emitted } from "@/workflows/events";
import { openIncident } from "@/workflows/incidents";
import { applyEffect, logSimNote, reverseEffect, type DrillScope } from "./apply-effects";
import { computeDrillScore, type DrillFacts, type DrillScore } from "./drill-score";
import { affectedNodes, loadDrillRun, loadHiddenTruth, milestoneTicks, nodeKey, tickAt, tickTimes } from "./drill-state";
import { EFFECT_TARGETS, normalizeEffectType, type EffectType, type TargetTable } from "./effects";
import { FRIGHTENED_TICKS, modeAt } from "./modes";
import { applyTrigger } from "./triggers";

export interface StartDrillInput {
  companyId: string;
  scenarioId: string;
  facilitatorPersonId: string;
  difficulty: number;
  agentsEnabled: boolean;
  secondsPerTick: number;
  seed?: number;
}

const INCIDENT_TYPE: Record<string, "quality" | "equipment" | "cold_chain" | "supply"> = {
  sterility_failure: "quality",
  em_anomaly: "quality",
  temp_excursion: "cold_chain",
  supplier_delay: "supply",
};

/** Whole hours, so ticks line up with the clock. */
const onTheHour = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

export async function startDrill(sql: Sql, input: StartDrillInput): Promise<{ drillRunId: string; worldId: string; incidentCode: string; emit: Emitted[] }> {
  const [scenario] = await sql<{ id: string; title: string; spec: unknown; approved: boolean }[]>`
    select id, title, spec, approved from scenarios where id = ${input.scenarioId} and company_id = ${input.companyId}`;
  if (!scenario) throw new Error("Scenario not found.");
  if (!scenario.approved) throw new Error("A facilitator must approve this scenario's preview before it can run.");
  const truth = await loadHiddenTruth(sql, scenario.id);

  const [live] = await sql<{ id: string }[]>`select id from worlds where company_id = ${input.companyId} and kind = 'live'`;
  if (!live) throw new Error("This company has no live world to copy.");
  // A fresh seed when none is given; never Math.random in simulation code.
  const seed = input.seed ?? randomInt(1, 2 ** 31 - 1);
  const world = await createDrillWorld(sql, live.id, seed, { simClock: onTheHour(await worldClock(sql, live.id)) });
  const simClock = world.simClock ?? onTheHour(new Date());

  const [run] = await sql<{ id: string }[]>`
    insert into drill_runs ${sql({
      scenarioId: scenario.id,
      worldId: world.id,
      companyId: input.companyId,
      seed,
      level: (scenario.spec as { level?: number }).level ?? 1,
      status: "paused",
      difficulty: input.difficulty,
      secondsPerTick: input.secondsPerTick,
      agentsEnabled: input.agentsEnabled,
      facilitatorPersonId: input.facilitatorPersonId,
    })}
    returning id`;
  if (!run) throw new Error("Failed to create the drill");
  const loaded = await loadDrillRun(sql, run.id);
  const scope: DrillScope = { worldId: world.id, companyId: input.companyId, tick: 0, simClock };
  await logSimNote(sql, scope, { type: "started", hidden: true, description: `Drill started with seed ${seed}.` });

  // The trigger's observable effect (e.g. the failed test record), then the incident it opens.
  const trigger = loaded.scenario.trigger;
  await applyTrigger(sql, { worldId: world.id, companyId: input.companyId, simClock }, trigger);
  const targetId = await resolveRef(sql, world.id, trigger.target);
  await logSimNote(sql, { ...scope }, {
    type: "trigger",
    hidden: false,
    target: { table: trigger.target.table as TargetTable, id: targetId, label: trigger.target.code },
    description: `${loaded.scenario.title}: the drill begins with ${trigger.target.code}.`,
  });
  const { incidentId, code } = await openIncident(
    sql,
    { worldId: world.id, companyId: input.companyId },
    {
      title: loaded.scenario.title,
      incidentType: INCIDENT_TYPE[trigger.type] ?? "quality",
      severity: loaded.scenario.level >= 2 ? "critical" : "warning",
      objects: [{ table: trigger.target.table, code: trigger.target.code }],
    },
    null,
  );
  await sql`update drill_runs set incident_id = ${incidentId} where id = ${run.id}`;
  await takeSeat(sql, { worldId: world.id, companyId: input.companyId, incidentId, role: "facilitator", personId: input.facilitatorPersonId });

  // The hidden spread starts at the true cause and at the trigger object.
  const causeId = await resolveRef(sql, world.id, truth.causeObject).catch(() => null);
  const seeds = [
    ...(causeId ? [{ table: truth.causeObject.table, id: causeId, label: truth.causeObject.code }] : []),
    { table: trigger.target.table, id: targetId, label: trigger.target.code },
  ].filter((s, i, all) => all.findIndex((o) => o.table === s.table && o.id === s.id) === i); // cause can be the trigger
  for (const s of seeds) {
    await logSimNote(sql, scope, { type: "spread_seed", actor: "spread", hidden: true, target: { ...s, table: s.table as TargetTable }, description: `Contamination present at ${s.label}.` });
  }

  const emit: Emitted[] = input.agentsEnabled ? [{ name: "incident/opened", data: { worldId: world.id, companyId: input.companyId, incidentId } }] : [];
  return { drillRunId: run.id, worldId: world.id, incidentCode: code, emit };
}

export async function setDrillStatus(sql: Sql, drillRunId: string, status: "running" | "paused"): Promise<void> {
  const [row] = await sql`update drill_runs set status = ${status} where id = ${drillRunId} and status <> 'ended' returning 1`;
  if (!row) throw new Error("The drill has ended.");
}

export async function setDifficulty(sql: Sql, drillRunId: string, difficulty: number): Promise<void> {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error("Difficulty runs from 1 to 5.");
  await sql`update drill_runs set difficulty = ${difficulty} where id = ${drillRunId} and status <> 'ended'`;
}

const scopeOf = async (sql: Sql, drillRunId: string) => {
  const run = await loadDrillRun(sql, drillRunId);
  if (run.status === "ended") throw new Error("The drill has ended.");
  return { run, scope: { worldId: run.worldId, companyId: run.companyId, tick: run.tick, simClock: run.simClock } satisfies DrillScope };
};

/** The facilitator injects an event (AGENTS.md: inject_event, facilitator only). */
export async function injectEffect(sql: Sql, drillRunId: string, type: string, target: { table: string; code: string }): Promise<Emitted[]> {
  const effectType = normalizeEffectType(type);
  if (!effectType) throw new Error(`Unknown event type "${type}".`);
  if (!EFFECT_TARGETS[effectType].includes(target.table as TargetTable)) throw new Error(`That event cannot target ${target.table}.`);
  const { run, scope } = await scopeOf(sql, drillRunId);
  const id = await resolveRef(sql, run.worldId, target);
  const applied = await applyEffect(sql, scope, "facilitator", effectType as EffectType, { table: target.table as TargetTable, id, label: target.code });
  return run.agentsEnabled ? applied.emit : [];
}

/** While the saboteurs are frightened, their recent effects can be reversed. */
export const REVERSIBLE_WINDOW_TICKS = 6;

export async function reverseSaboteurEffect(sql: Sql, drillRunId: string, effectId: string): Promise<void> {
  const { run, scope } = await scopeOf(sql, drillRunId);
  if (modeAt(run.tick, await milestoneTicks(sql, run.worldId)) !== "frightened") {
    throw new Error(`Effects can only be reversed while the saboteurs are frightened (for ${FRIGHTENED_TICKS} hours after a team milestone).`);
  }
  const [effect] = await sql<{ tick: number; actor: string }[]>`select tick, actor from sim_effects where world_id = ${run.worldId} and id = ${effectId}`;
  if (!effect || !["hunter", "ambusher", "flanker", "wanderer"].includes(effect.actor)) throw new Error("Only saboteur effects can be reversed.");
  if (run.tick - effect.tick > REVERSIBLE_WINDOW_TICKS) throw new Error("That effect is too old to reverse.");
  await reverseEffect(sql, scope, effectId, "facilitator");
}

// ─── Ending and scoring ──────────────────────────────────────────────

export async function gatherFacts(sql: Sql, drillRunId: string): Promise<DrillFacts> {
  const run = await loadDrillRun(sql, drillRunId);
  const truth = await loadHiddenTruth(sql, run.scenarioId);
  const w = run.worldId;
  const times = await tickTimes(sql, w);

  const [contained] = await sql<{ tick: number }[]>`select tick from sim_effects where world_id = ${w} and effect_type = 'contained' order by id limit 1`;
  const affected = await affectedNodes(sql, w);
  const mustProtect = await Promise.all(
    run.scenario.success.mustProtect.map(async (ref) => {
      const id = await resolveRef(sql, w, ref).catch(() => null);
      return { code: ref.code, reached: id ? affected.has(nodeKey(ref.table, id)) : false };
    }),
  );

  const [rca] = await sql<{ id: string; record: { answer: unknown } }[]>`
    select id, record from decision_records where world_id = ${w} and agent_id = 'root_cause_analyst' order by created_at desc limit 1`;
  let rootCause: DrillFacts["rootCause"] = null;
  if (rca) {
    const answer = AgentAnswer.safeParse(rca.record.answer);
    const params = answer.success && answer.data.proposedAction?.type === "accept_root_cause" ? answer.data.proposedAction.params : {};
    const [accepted] = await sql`select 1 from approvals where world_id = ${w} and decision_record_id = ${rca.id} and outcome = 'approved'`;
    rootCause = {
      summary: answer.success ? answer.data.summary : "",
      cause: typeof params.cause === "string" ? params.cause : "",
      causeObject: params.causeObject,
      accepted: Boolean(accepted),
    };
  }

  const requests = await sql<{ decisionRecordId: string; seat: string; at: Date }[]>`
    select payload ->> 'decisionRecordId' as decision_record_id, payload ->> 'seat' as seat, created_at as at
    from incident_events where world_id = ${w} and event_type = 'approval_requested'`;
  const decided = await sql<{ decisionRecordId: string; at: Date; personId: string | null }[]>`
    select decision_record_id, created_at as at, person_id from approvals
    where world_id = ${w} and outcome in ('approved', 'rejected', 'override')`;
  const decisions = requests.map((r) => {
    const d = decided.find((x) => x.decisionRecordId === r.decisionRecordId);
    return { seat: r.seat, ticks: d ? tickAt(times, d.at) - tickAt(times, r.at) : null, byAi: d ? d.personId === null : true };
  });

  const [fabricated] = await sql<{ n: number }[]>`
    select coalesce(sum(jsonb_array_length(coalesce(record -> 'rejectedSources', '[]'::jsonb))), 0)::int as n from decision_records where world_id = ${w}`;
  const [cost] = await sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 as usd from agent_runs where world_id = ${w}`;

  return {
    hiddenTruth: truth,
    rootCause,
    durationTicks: run.scenario.durationTicks,
    containWithinTicks: run.scenario.success.containWithinTicks,
    containedAtTick: contained?.tick ?? null,
    spreadReached: affected.size,
    mustProtect,
    decisions,
    fabricatedSources: fabricated?.n ?? 0,
    costUsd: cost?.usd ?? 0,
  };
}

export async function endDrill(sql: Sql, drillRunId: string): Promise<DrillScore> {
  const run = await loadDrillRun(sql, drillRunId);
  if (run.status === "ended") throw new Error("The drill has already ended.");
  const [ended] = await sql`update drill_runs set status = 'ended', ended_at = now() where id = ${drillRunId} and status <> 'ended' returning 1`;
  if (!ended) throw new Error("The drill has already ended.");
  await logSimNote(sql, { worldId: run.worldId, companyId: run.companyId, tick: run.tick, simClock: run.simClock }, { type: "ended", hidden: false, description: "The drill has ended." });
  const score = computeDrillScore(await gatherFacts(sql, drillRunId));
  await sql`update drill_runs set score = ${sql.json(score as unknown as Parameters<typeof sql.json>[0])} where id = ${drillRunId}`;
  return score;
}
