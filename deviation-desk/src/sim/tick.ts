/**
 * One simulated hour of a drill (CLAUDE.md §9): advance the clock, apply scheduled twists, let the
 * hidden contamination spread, let the saboteurs act, and let AI-played seats decide.
 * Every random choice comes from the drill seed and the tick number, so a drill replays exactly.
 */
import { AgentAnswer } from "@/agents/contract";
import { executeApproved } from "@/approvals/executors";
import { recordApproval } from "@/approvals/record-approval";
import type { Sql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import type { Emitted } from "@/workflows/events";
import { aiSeatDecision } from "./ai-seats";
import { applyEffect, logSimNote, reverseEffect, type DrillScope, type EffectActor } from "./apply-effects";
import { affectedNodes, loadDrillRun, milestoneTicks, newMilestones, saboteurContext, spreadGraph, tickAt, tickTimes, type DrillRun } from "./drill-state";
import { normalizeEffectType, type TargetTable } from "./effects";
import { modeAt, type SaboteurMode } from "./modes";
import { createRng } from "./prng";
import { planSaboteurs } from "./saboteurs";
import { canStillSpread, spreadStep, type EdgeKind } from "./spread";

const HOUR_MS = 3_600_000;
const SITE_TIME_ZONE = "America/Toronto";

export interface TickResult {
  tick: number;
  mode: SaboteurMode;
  /** Observable events for the agent chain; sent only when the drill lets agents respond. */
  observable: Emitted[];
  /** Workflow bookkeeping (resolved decisions), always sent. */
  followUps: Emitted[];
  reachedEnd: boolean;
}

/** Seed for one tick's random stream: mixes the drill seed with the tick number. */
export const tickSeed = (seed: number, tick: number) => (seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0;

const siteHour = (d: Date) => Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: SITE_TIME_ZONE }).format(d));

async function applyTwists(sql: Sql, run: DrillRun, scope: DrillScope): Promise<Emitted[]> {
  const out: Emitted[] = [];
  for (const twist of run.scenario.twists.filter((t) => t.atTick === scope.tick)) {
    const type = normalizeEffectType(twist.effect.type);
    if (!type) continue;
    const id = await resolveRef(sql, run.worldId, twist.effect.target).catch(() => null);
    if (!id) continue;
    const actor: EffectActor = twist.by === "facilitator" ? "twist" : twist.by;
    const applied = await applyEffect(sql, scope, actor, type, { table: twist.effect.target.table as TargetTable, id, label: twist.effect.target.code });
    out.push(...applied.emit);
  }
  return out;
}

/** Wanderer false alarms clear on their own an hour later, as real false alarms do. */
async function clearFalseAlarms(sql: Sql, scope: DrillScope): Promise<void> {
  const alarms = await sql<{ id: string }[]>`
    select id::text as id from sim_effects e
    where world_id = ${scope.worldId} and actor = 'wanderer' and effect_type = 'false_alarm' and tick = ${scope.tick - 1}
      and not exists (select 1 from sim_effects r where r.world_id = e.world_id and r.reverses_effect_id = e.id)`;
  for (const a of alarms) await reverseEffect(sql, scope, a.id, "engine");
}

async function spread(sql: Sql, run: DrillRun, scope: DrillScope, rng: ReturnType<typeof createRng>): Promise<void> {
  if (run.scenario.spread.mode !== "spreader") return;
  const { edges, contained, labels } = await spreadGraph(sql, run.worldId);
  const affected = await affectedNodes(sql, run.worldId);
  const kinds = new Set<EdgeKind>(run.scenario.spread.edgeTypes);
  for (const key of spreadStep(affected, edges, contained, kinds, run.scenario.spread.perTickProbability, rng)) {
    const [table, id] = key.split(":") as [string, string];
    await logSimNote(sql, scope, {
      type: "spread",
      actor: "spread",
      hidden: true,
      target: { table: table as TargetTable, id, label: labels.get(key) ?? id },
      description: `Contamination reached ${labels.get(key) ?? key}.`,
    });
    affected.add(key);
  }
  const [already] = await sql`select 1 from sim_effects where world_id = ${run.worldId} and effect_type = 'contained'`;
  if (!already && !canStillSpread(affected, edges, contained, kinds)) {
    await logSimNote(sql, scope, { type: "contained", hidden: true, description: "Holds now cut every path the contamination could take." });
  }
}

async function aiSeats(sql: Sql, run: DrillRun, scope: DrillScope): Promise<{ followUps: Emitted[]; observable: Emitted[] }> {
  const followUps: Emitted[] = [];
  const observable: Emitted[] = [];
  if (!run.incidentId) return { followUps, observable };
  const times = await tickTimes(sql, run.worldId);
  const pending = await sql<Array<{ id: string; record: { answer: unknown }; requestedAt: Date | null; asks: number }>>`
    select d.id, d.record,
      (select min(e.created_at) from incident_events e where e.world_id = d.world_id and e.event_type = 'approval_requested'
        and e.payload ->> 'decisionRecordId' = d.id::text) as requested_at,
      (select count(*)::int from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id and a.outcome = 'more_evidence') as asks
    from decision_records d
    where d.world_id = ${run.worldId} and d.incident_id = ${run.incidentId} and d.requires_approval
      and not exists (select 1 from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id
        and a.outcome in ('approved', 'rejected', 'override'))
    order by d.created_at`;

  for (const p of pending) {
    const answer = AgentAnswer.safeParse(p.record.answer);
    const seat = answer.success ? answer.data.approvalSeat : undefined;
    if (!seat || !answer.success || !answer.data.proposedAction) continue;
    // Only seats nobody is sitting in are played by AI.
    const [holder] = await sql<{ personId: string | null }[]>`
      select person_id from seats where world_id = ${run.worldId} and incident_id = ${run.incidentId} and role = ${seat}`;
    if (holder?.personId) continue;

    const requestedTick = p.requestedAt ? tickAt(times, p.requestedAt) : scope.tick;
    const hourAtRequest = siteHour(new Date(scope.simClock.getTime() - (scope.tick - requestedTick) * HOUR_MS));
    const decision = aiSeatDecision(
      { decisionRecordId: p.id, seat, actionType: answer.data.proposedAction.type, requestedTick, asks: p.asks },
      scope.tick,
      hourAtRequest,
      run.seed,
    );
    if (!decision) continue;
    const approval = await recordApproval(sql, { worldId: run.worldId, decisionRecordId: p.id, seat, personId: null, outcome: decision.outcome, reason: decision.reason });
    const resolved = { worldId: run.worldId, companyId: run.companyId, incidentId: run.incidentId, decisionRecordId: p.id, approvalId: approval.approvalId, outcome: decision.outcome };
    followUps.push({ name: "decision/resolved", data: resolved });
    if (decision.outcome === "approved") observable.push(...(await executeApproved(sql, run.worldId, p.id)).emit);
  }
  return { followUps, observable };
}

/**
 * Advances a drill by one tick. Callers pass the tick they are advancing from (what the Step button
 * showed, what autoplay loaded), so a double click or overlapping autoplay never skips an hour:
 * the tick only moves if it is still the one the caller saw.
 */
export async function runTick(sql: Sql, drillRunId: string, expectedTick?: number): Promise<TickResult | null> {
  const before = await loadDrillRun(sql, drillRunId);
  if (before.status === "ended") return null;
  const from = expectedTick ?? before.tick;
  const [moved] = await sql<{ tick: number }[]>`
    update drill_runs set tick = tick + 1 where id = ${drillRunId} and tick = ${from} and status <> 'ended' returning tick`;
  if (!moved) return null;
  const [world] = await sql<{ simClock: Date }[]>`
    update worlds set sim_clock = sim_clock + interval '1 hour' where id = ${before.worldId} returning sim_clock`;
  const run = { ...before, tick: moved.tick, simClock: world?.simClock ?? new Date(before.simClock.getTime() + HOUR_MS) };
  const scope: DrillScope = { worldId: run.worldId, companyId: run.companyId, tick: run.tick, simClock: run.simClock };

  const times = await tickTimes(sql, run.worldId);
  const previousTickAt = times.at(-1)?.at ?? new Date(0);
  await logSimNote(sql, scope, { type: "tick", hidden: true, description: `Hour ${run.tick}.` });

  // Team milestones make the saboteurs frightened for a while, counted from the hour they happened.
  for (const m of await newMilestones(sql, run.worldId, previousTickAt)) {
    await logSimNote(sql, { ...scope, tick: tickAt(times, m.at) }, {
      type: "milestone",
      hidden: false,
      description: `The team's approved ${m.actionType.replace(/_/g, " ")} has the saboteurs on the back foot.`,
      payload: { actionType: m.actionType, decisionRecordId: m.decisionRecordId },
    });
  }
  const mode = modeAt(run.tick, await milestoneTicks(sql, run.worldId));
  // Separate streams, so how far the spread got never shifts what the saboteurs roll.
  const spreadRng = createRng(tickSeed(run.seed ^ 0x5eed, run.tick));
  const saboteurRng = createRng(tickSeed(run.seed, run.tick));

  const observable: Emitted[] = [];
  observable.push(...(await applyTwists(sql, run, scope)));
  await clearFalseAlarms(sql, scope);
  await spread(sql, run, scope, spreadRng);
  const ctx = await saboteurContext(sql, run.worldId, run.tick, run.difficulty, mode);
  for (const e of planSaboteurs(ctx, saboteurRng)) observable.push(...(await applyEffect(sql, scope, e.actor, e.type, e.target)).emit);
  const seats = await aiSeats(sql, run, scope);
  observable.push(...seats.observable);

  return { tick: run.tick, mode, observable, followUps: seats.followUps, reachedEnd: run.tick >= run.scenario.durationTicks };
}
