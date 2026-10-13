/**
 * Tools agents may call. Rules:
 * - Every query filters by ctx.worldId and ctx.companyId. Never accept a world id from the model.
 * - The model never writes SQL. Tools expose allow-listed, parameterized queries only.
 * - Results are trimmed to what the agent needs (limits on rows and fields).
 * - Rows returned must include their id so agents can cite them as sources.
 */
import { z } from "zod";
import type { AgentTool } from "./types";

const QUERYABLE = [
  "rooms", "equipment", "production_lines", "batches", "material_lots", "inventory_lots",
  "orders", "shipments", "people", "records", "suppliers", "locations",
] as const;

const queryTwinInput = z.object({
  table: z.enum(QUERYABLE),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  limit: z.number().int().min(1).max(50).default(20),
});

export const queryTwin: AgentTool<typeof queryTwinInput> = {
  name: "query_twin",
  description:
    "Look up rows in the company twin. Choose a table and equality filters on its columns. Returns up to `limit` rows, each with its id for citation.",
  input: queryTwinInput,
  jsonSchema: {
    type: "object",
    properties: {
      table: { type: "string", enum: [...QUERYABLE] },
      filters: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["table"],
  },
  async run(_input, _ctx) {
    // TODO(Phase 2): parameterized select with column allow-list per table, filtered by world_id + company_id.
    throw new Error("query_twin not implemented yet");
  },
};

const traceImpactInput = z.object({
  startTable: z.enum(["batches", "equipment", "material_lots", "rooms"]),
  startId: z.string(),
  maxDepth: z.number().int().min(1).max(6).default(4),
});

export const traceImpact: AgentTool<typeof traceImpactInput> = {
  name: "trace_impact",
  description:
    "Follow the impact graph from a starting object through shared equipment, shared material lots, inventory and shipments. Returns connected nodes with the path that links them.",
  input: traceImpactInput,
  jsonSchema: {
    type: "object",
    properties: {
      startTable: { type: "string", enum: ["batches", "equipment", "material_lots", "rooms"] },
      startId: { type: "string" },
      maxDepth: { type: "integer", minimum: 1, maximum: 6 },
    },
    required: ["startTable", "startId"],
  },
  async run(_input, _ctx) {
    // TODO(Phase 1): recursive CTE over batch_equipment_usage, batch_material_usage, shipment_items with depth limit.
    throw new Error("trace_impact not implemented yet");
  },
};

/** Registry of all tools by name. Agents only receive the ones in their allowedTools. */
export const tools: Record<string, AgentTool> = {
  [queryTwin.name]: queryTwin,
  [traceImpact.name]: traceImpact,
  // TODO(Phase 2): get_sensor_history, find_open_incidents, get_incident, list_agents,
  // get_records, search_sops, list_evidence.
};
