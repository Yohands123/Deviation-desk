import { z } from "zod";
import { getSql } from "@/db/client";
import { findExcursions } from "@/monitoring/excursions";
import { STORAGE_RANGES, type StorageCondition } from "@/monitoring/watchers";
import { resolveSubject } from "./subject";
import type { AgentTool } from "./types";

const input = z
  .object({
    shipmentId: z.string().optional(),
    shipmentCode: z.string().optional().describe('e.g. "SH-117".'),
  })
  .refine((v) => v.shipmentId || v.shipmentCode, "Give shipmentId or shipmentCode.");

export const getShipmentTelemetry: AgentTool<typeof input> = {
  name: "get_shipment_telemetry",
  description:
    'Get a shipment\'s temperature readings (oldest first), its storage range, and computed excursions (start, end, duration in hours, peak). Cite readings as table "sensor_readings" and the shipment as "shipments".',
  input,
  async run({ shipmentId, shipmentCode }, ctx) {
    const sql = getSql();
    const id = await resolveSubject(sql, ctx.worldId, "shipments", { id: shipmentId, code: shipmentCode });
    const [shipment] = await sql<{ id: string; shipmentCode: string; status: string; storageCondition: StorageCondition; carrier: string | null }[]>`
      select id, shipment_code, status, storage_condition, carrier from shipments where world_id = ${ctx.worldId} and id = ${id}`;
    if (!shipment) throw new Error("Shipment not found");
    const rows = await sql<{ id: string; value: string; recordedAt: Date }[]>`
      select id::text as id, value, recorded_at from sensor_readings
      where world_id = ${ctx.worldId} and subject_id = ${id} and metric = 'temp_c'
      order by recorded_at`;
    const readings = rows.map((r) => ({ id: r.id, value: Number(r.value), recordedAt: r.recordedAt }));
    return {
      citeAs: { shipment: "shipments", readings: "sensor_readings" },
      shipment,
      rangeC: STORAGE_RANGES[shipment.storageCondition],
      excursions: findExcursions(readings, shipment.storageCondition),
      readings,
    };
  },
};
