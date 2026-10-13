import { z } from "zod";
import { getSql } from "@/db/client";
import { COLD_CHAIN_RANGE, THRESHOLDS } from "@/monitoring/watchers";
import { resolveSubject } from "./subject";
import type { AgentTool } from "./types";

const input = z
  .object({
    subjectTable: z.enum(["rooms", "equipment", "shipments"]),
    subjectId: z.string().optional(),
    subjectCode: z.string().optional().describe('Or its name/code, e.g. "Fill Room 3", "SH-117".'),
    metric: z.string().describe('e.g. "em_cfu", "temp_c".'),
    limit: z.number().int().min(1).max(90).default(30).describe("How many of the most recent readings."),
  })
  .refine((v) => v.subjectId || v.subjectCode, "Give subjectId or subjectCode.");

export const getSensorHistory: AgentTool<typeof input> = {
  name: "get_sensor_history",
  description:
    'Get the most recent sensor readings for a room, piece of equipment or shipment, oldest first, with the alert/action thresholds for the metric. Cite readings as table "sensor_readings".',
  input,
  async run({ subjectTable, subjectId, subjectCode, metric, limit }, ctx) {
    const sql = getSql();
    const id = await resolveSubject(sql, ctx.worldId, subjectTable, { id: subjectId, code: subjectCode });
    const recent = await sql<{ id: string; value: string; recordedAt: Date }[]>`
      select id::text as id, value, recorded_at from sensor_readings
      where world_id = ${ctx.worldId} and subject_id = ${id} and metric = ${metric}
      order by recorded_at desc limit ${limit}`;
    return {
      citeAs: "sensor_readings",
      subject: { table: subjectTable, id },
      metric,
      thresholds: metric === "temp_c" ? COLD_CHAIN_RANGE : (THRESHOLDS[metric] ?? null),
      readings: recent.reverse().map((r) => ({ id: r.id, value: Number(r.value), recordedAt: r.recordedAt })),
    };
  },
};
