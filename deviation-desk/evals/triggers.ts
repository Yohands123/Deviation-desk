/**
 * Applies a scenario's trigger to a drill world and returns the first event of the chain.
 * Only the trigger's observable effects are written; the hidden truth never enters the world.
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

const TRIGGERS: Record<string, (sql: Sql, scope: DrillScope, trigger: Trigger) => Promise<Emitted>> = {
  sterility_failure: sterilityFailure,
  em_anomaly: emAnomaly,
};

export function applyTrigger(sql: Sql, scope: DrillScope, trigger: Trigger): Promise<Emitted> {
  const apply = TRIGGERS[trigger.type];
  if (!apply) throw new Error(`Unknown trigger type "${trigger.type}". Known: ${Object.keys(TRIGGERS).join(", ")}`);
  return apply(sql, scope, trigger);
}
