/**
 * Writes simulation effects into a drill world as the team would observe them: a sensor reading,
 * a failed test record, a faulted machine, a carrier's field report. Every effect is logged in
 * sim_effects with who caused it, which the team only learns at the debrief.
 * Principle 5: refuses to touch anything but a drill world.
 */
import type postgres from "postgres";
import type { Sql } from "@/db/client";
import type { Emitted } from "@/workflows/events";
import { describeEffect, describeReversal, EFFECT_TARGETS, type EffectType } from "./effects";
import type { Candidate } from "./saboteurs";

export type EffectActor = "trigger" | "twist" | "hunter" | "ambusher" | "flanker" | "wanderer" | "facilitator" | "engine";

export interface DrillScope {
  worldId: string;
  companyId: string;
  tick: number;
  simClock: Date;
}

export interface AppliedEffect {
  effectId: string;
  description: string;
  /** Events for the agent chain (sent only when the drill lets agents respond). */
  emit: Emitted[];
}

const asJson = (v: Record<string, unknown>) => v as postgres.JSONValue;

export async function assertDrillWorld(sql: Sql, worldId: string): Promise<void> {
  const [world] = await sql<{ kind: string }[]>`select kind from worlds where id = ${worldId}`;
  if (world?.kind !== "drill") throw new Error("Simulation effects may only be applied to a drill world.");
}

async function roomOfBatch(sql: Sql, worldId: string, batchId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await sql<{ id: string; name: string }[]>`
    select r.id, r.name from batches b
    join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
    join rooms r on r.world_id = pl.world_id and r.id = pl.room_id
    where b.world_id = ${worldId} and b.id = ${batchId}`;
  return row ?? null;
}

async function logEffect(
  sql: Sql,
  scope: DrillScope,
  e: { actor: EffectActor | "spread"; type: string; target: Candidate | null; description: string; hidden?: boolean; reversible?: boolean; reverses?: string; payload?: Record<string, unknown> },
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into sim_effects ${sql({
      worldId: scope.worldId,
      companyId: scope.companyId,
      tick: scope.tick,
      actor: e.actor,
      effectType: e.type,
      targetTable: e.target?.table ?? null,
      targetId: e.target?.id ?? null,
      targetLabel: e.target?.label ?? null,
      description: e.description,
      hidden: e.hidden ?? false,
      reversible: e.reversible ?? false,
      reversesEffectId: e.reverses ?? null,
      payload: sql.json(asJson(e.payload ?? {})),
    })}
    returning id::text as id`;
  if (!row) throw new Error("Failed to log simulation effect");
  return row.id;
}

/** Bookkeeping rows (ticks, milestones, the hidden spread) that change nothing in the twin. */
export function logSimNote(
  sql: Sql,
  scope: DrillScope,
  note: { type: string; description: string; hidden: boolean; target?: Candidate | null; payload?: Record<string, unknown>; actor?: "engine" | "spread" },
): Promise<string> {
  return logEffect(sql, scope, { actor: note.actor ?? "engine", type: note.type, target: note.target ?? null, description: note.description, hidden: note.hidden, payload: note.payload });
}

export async function applyEffect(sql: Sql, scope: DrillScope, actor: EffectActor, type: EffectType, target: Candidate): Promise<AppliedEffect> {
  await assertDrillWorld(sql, scope.worldId);
  if (!EFFECT_TARGETS[type].includes(target.table)) throw new Error(`${type} cannot target ${target.table}.`);
  const base = { worldId: scope.worldId, companyId: scope.companyId };
  const emit: Emitted[] = [];

  switch (type) {
    case "em_spike":
    case "false_alarm": {
      const room = target.table === "rooms" ? { id: target.id, name: target.label } : await roomOfBatch(sql, scope.worldId, target.id);
      if (!room) throw new Error(`No room found for ${target.label}.`);
      const value = type === "em_spike" ? 4 : 3;
      await sql`insert into sensor_readings ${sql({ ...base, subjectTable: "rooms", subjectId: room.id, metric: "em_cfu", value, recordedAt: scope.simClock })}`;
      emit.push({ name: "sensor/anomaly", data: { ...base, subjectTable: "rooms", subjectId: room.id, metric: "em_cfu", value, recordedAt: scope.simClock.toISOString(), level: "action" } });
      break;
    }
    case "test_failure": {
      await sql`insert into records ${sql({
        ...base,
        recordType: "test_result",
        subjectTable: "batches",
        subjectId: target.id,
        title: `${target.label} release test: FAIL`,
        body: `Release testing for ${target.label} failed. Investigation pending.`,
        recordedAt: scope.simClock,
      })}`;
      emit.push({ name: "report/submitted", data: { ...base, reportedBy: "QC laboratory", text: `Release test for batch ${target.label} failed. Result recorded in QC.` } });
      break;
    }
    case "equipment_fault": {
      await sql`update equipment set status = 'failed' where world_id = ${scope.worldId} and id = ${target.id}`;
      await sql`insert into records ${sql({ ...base, recordType: "maintenance", subjectTable: "equipment", subjectId: target.id, title: `${target.label} fault stop`, body: `${target.label} stopped with a fault during operation.`, recordedAt: scope.simClock })}`;
      emit.push({ name: "report/submitted", data: { ...base, reportedBy: "Line operator", text: `${target.label} stopped with a fault.` } });
      break;
    }
    case "shipment_delay": {
      await sql`insert into records ${sql({ ...base, recordType: "field_report", subjectTable: "shipments", subjectId: target.id, title: `${target.label} delayed`, body: describeEffect(type, target.label), recordedAt: scope.simClock })}`;
      break;
    }
    case "temp_excursion": {
      const readings = [9.6, 10.8].map((value, i) => ({ ...base, subjectTable: "shipments", subjectId: target.id, metric: "temp_c", value, recordedAt: new Date(scope.simClock.getTime() - (1 - i) * 1800_000) }));
      await sql`insert into sensor_readings ${sql(readings)}`;
      emit.push({ name: "shipment/temp_excursion", data: { ...base, subjectTable: "shipments", subjectId: target.id, metric: "temp_c", value: 10.8, recordedAt: scope.simClock.toISOString() } });
      break;
    }
  }

  const description = describeEffect(type, target.label);
  const effectId = await logEffect(sql, scope, { actor, type, target, description, reversible: true });
  return { effectId, description, emit };
}

/** Undo an effect the way it would be undone on site: a retest, a reset, a resolved delay. */
export async function reverseEffect(sql: Sql, scope: DrillScope, effectId: string, actor: "engine" | "facilitator"): Promise<string> {
  await assertDrillWorld(sql, scope.worldId);
  const [effect] = await sql<{ effectType: string; targetTable: string | null; targetId: string | null; targetLabel: string | null; reversible: boolean }[]>`
    select effect_type, target_table, target_id::text as target_id, target_label, reversible
    from sim_effects where world_id = ${scope.worldId} and id = ${effectId}`;
  if (!effect || !effect.reversible || !effect.targetId || !effect.targetTable) throw new Error("That effect cannot be reversed.");
  const [done] = await sql`select 1 from sim_effects where world_id = ${scope.worldId} and reverses_effect_id = ${effectId}`;
  if (done) throw new Error("That effect was already reversed.");

  const type = effect.effectType as EffectType;
  const label = effect.targetLabel ?? "the object";
  const base = { worldId: scope.worldId, companyId: scope.companyId };
  if (type === "em_spike" || type === "false_alarm") {
    const room = effect.targetTable === "rooms" ? { id: effect.targetId } : await roomOfBatch(sql, scope.worldId, effect.targetId);
    if (room) await sql`insert into sensor_readings ${sql({ ...base, subjectTable: "rooms", subjectId: room.id, metric: "em_cfu", value: 0, recordedAt: scope.simClock })}`;
  }
  if (type === "equipment_fault") await sql`update equipment set status = 'running' where world_id = ${scope.worldId} and id = ${effect.targetId}`;
  const subjectTable = type === "em_spike" || type === "false_alarm" ? null : effect.targetTable;
  await sql`insert into records ${sql({
    ...base,
    recordType: type === "test_failure" ? "test_result" : "field_report",
    subjectTable,
    subjectId: subjectTable ? effect.targetId : null,
    title: `Update: ${label}`,
    body: describeReversal(type, label),
    recordedAt: scope.simClock,
  })}`;
  return logEffect(sql, scope, {
    actor,
    type: `reverse_${type}`,
    target: { table: effect.targetTable as Candidate["table"], id: effect.targetId, label },
    description: describeReversal(type, label),
    reverses: effectId,
  });
}
