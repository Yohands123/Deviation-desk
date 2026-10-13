/**
 * Applies a scenario's trigger to a drill world and returns the first event of the chain.
 * Only the trigger's observable effects are written; the hidden truth never enters the world.
 * Used by drills (src/sim/drills.ts) and the eval harness.
 */
import type { Sql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import type { Scenario } from "@/sim/scenario";
import type { Emitted } from "@/workflows/events";
import { THRESHOLDS } from "@/monitoring/watchers";

interface DrillScope {
  worldId: string;
  companyId: string;
  simClock: Date;
}

type Trigger = Scenario["trigger"];

async function sterilityFailure(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  if (trigger.target.table !== "batches") throw new Error("sterility_failure targets a batch");
  const batchCode = trigger.target.code;
  const batchId = await resolveRef(sql, scope.worldId, trigger.target);
  await sql`insert into records ${sql({
    worldId: scope.worldId,
    companyId: scope.companyId,
    recordType: "test_result",
    subjectTable: "batches",
    subjectId: batchId,
    title: `${batchCode} sterility test: FAIL`,
    body: `14-day sterility incubation per SOP-QC-021 completed. Growth observed in 2 of 20 test units. Organism identification pending. Analyst: Kwame Mensah.`,
    recordedAt: scope.simClock,
  })}`;
  return {
    name: "report/submitted",
    data: {
      worldId: scope.worldId,
      companyId: scope.companyId,
      reportedBy: "Kwame Mensah (QC Microbiologist)",
      text: `Sterility test for batch ${batchCode} failed: growth in 2 of 20 units after 14 days. Result recorded in QC today.`,
    },
  };
}

async function emAnomaly(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  if (trigger.target.table !== "rooms") throw new Error("em_anomaly targets a room");
  const roomId = await resolveRef(sql, scope.worldId, trigger.target);
  const [reading] = await sql<{ value: string; recordedAt: Date }[]>`
    select value, recorded_at from sensor_readings
    where world_id = ${scope.worldId} and subject_id = ${roomId} and metric = 'em_cfu'
    order by recorded_at desc limit 1`;
  if (!reading) throw new Error(`No EM readings for ${trigger.target.code}`);
  const value = Number(reading.value);
  const t = THRESHOLDS.em_cfu;
  return {
    name: "sensor/anomaly",
    data: {
      worldId: scope.worldId,
      companyId: scope.companyId,
      subjectTable: "rooms",
      subjectId: roomId,
      metric: "em_cfu",
      value,
      recordedAt: reading.recordedAt.toISOString(),
      level: t && value >= t.action ? "action" : "alert",
    },
  };
}

/** Writes a warm stretch into a shipment's telemetry and returns the watcher's excursion event. */
async function tempExcursion(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  if (trigger.target.table !== "shipments") throw new Error("temp_excursion targets a shipment");
  const shipmentId = await resolveRef(sql, scope.worldId, trigger.target);
  const peakC = Number(trigger.params.peakC ?? 11);
  const hours = Number(trigger.params.hours ?? 5);
  // Hourly readings: climb past 8 °C, hold near the peak, end still warm (ongoing at sim time).
  const readings = Array.from({ length: hours + 1 }, (_, i) => ({
    worldId: scope.worldId,
    companyId: scope.companyId,
    subjectTable: "shipments",
    subjectId: shipmentId,
    metric: "temp_c",
    value: Math.round((8.6 + (peakC - 8.6) * Math.min(1, i / 2)) * 10) / 10,
    recordedAt: new Date(scope.simClock.getTime() - (hours - i) * 3_600_000),
  }));
  // The scenario defines what the logger recorded in this window, so replace any seeded readings
  // there; overlapping in-range and out-of-range readings would be contradictory telemetry.
  const first = readings[0];
  const last = readings.at(-1);
  if (!first || !last) throw new Error("temp_excursion needs at least one reading");
  await sql`
    delete from sensor_readings
    where world_id = ${scope.worldId} and subject_id = ${shipmentId} and metric = 'temp_c'
      and recorded_at between ${first.recordedAt} and ${last.recordedAt}`;
  await sql`insert into sensor_readings ${sql(readings)}`;
  return {
    name: "shipment/temp_excursion",
    data: { worldId: scope.worldId, companyId: scope.companyId, subjectTable: "shipments", subjectId: shipmentId, metric: "temp_c", value: last?.value, recordedAt: last?.recordedAt.toISOString() },
  };
}

/** A supplier's delay notice, as the Supply Chain Lead would forward it. */
async function supplierDelay(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  if (trigger.target.table !== "suppliers") throw new Error("supplier_delay targets a supplier");
  await resolveRef(sql, scope.worldId, trigger.target); // must exist
  return {
    name: "supplier/delay",
    data: {
      worldId: scope.worldId,
      companyId: scope.companyId,
      reportedBy: "Tomás Reyes (Supply Chain Lead)",
      supplier: trigger.target.code,
      material: typeof trigger.params.material === "string" ? trigger.params.material : undefined,
      delayDays: Number(trigger.params.delayDays ?? 21),
      note: typeof trigger.params.note === "string" ? trigger.params.note : undefined,
    },
  };
}

const TRIGGERS: Record<string, (sql: Sql, scope: DrillScope, trigger: Trigger) => Promise<Emitted>> = {
  sterility_failure: sterilityFailure,
  em_anomaly: emAnomaly,
  temp_excursion: tempExcursion,
  supplier_delay: supplierDelay,
};

export function applyTrigger(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  const apply = TRIGGERS[trigger.type];
  if (!apply) throw new Error(`Unknown trigger type "${trigger.type}". Known: ${Object.keys(TRIGGERS).join(", ")}`);
  return apply(sql, scope, trigger);
}
