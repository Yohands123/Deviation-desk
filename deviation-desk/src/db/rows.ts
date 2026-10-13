/**
 * Zod schemas for rows read from Postgres (camelCase, see client.ts). Parse query results with
 * these at the boundary so the rest of the code never trusts an unchecked row.
 * Note: postgres.js returns bigint and numeric as strings and timestamptz as Date.
 */
import { z } from "zod";

export const WorldKind = z.enum(["live", "drill"]);

export const WorldRow = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  kind: WorldKind,
  clonedFrom: z.uuid().nullable(),
  seed: z.coerce.number().int().nullable(),
  simClock: z.date().nullable(),
  status: z.enum(["active", "archived"]),
  createdAt: z.date(),
});
export type WorldRow = z.infer<typeof WorldRow>;

/** Tables that are nodes of the impact graph (impact_edges / twin_nodes views). */
export const GraphTable = z.enum([
  "rooms",
  "equipment",
  "material_lots",
  "batches",
  "inventory_lots",
  "shipments",
  "orders",
  "locations",
]);
export type GraphTable = z.infer<typeof GraphTable>;

export const NodeRef = z.object({ table: GraphTable, id: z.uuid() });
export type NodeRef = z.infer<typeof NodeRef>;

export const TraceNode = z.object({
  table: GraphTable,
  id: z.uuid(),
  label: z.string(),
  status: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  /** Edge type that reached this node; null for the start node. */
  via: z.string().nullable(),
  /** Shortest path from the start node to this node, inclusive at both ends. */
  path: z.array(NodeRef),
});
export type TraceNode = z.infer<typeof TraceNode>;
