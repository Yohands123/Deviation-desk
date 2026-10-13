/**
 * Impact trace: everything connected to a starting object through the impact graph
 * (docs/DOMAIN.md §Impact graph; edges come from the impact_edges view).
 *
 * The recursive CTE carries (node, depth, parent) rather than whole paths. Enumerating every path
 * explodes when many batches share lots; this form is bounded by edges × depth. The shortest path
 * to each node is rebuilt from parent pointers afterwards.
 *
 * The trace reports connectivity, not risk: held stock and held shipments are still traversed, and
 * their status is returned so callers can see where containment already cuts the spread.
 */
import { z } from "zod";
import type { Sql } from "./client";
import { GraphTable, TraceNode, type NodeRef } from "./rows";

export const MAX_TRACE_DEPTH = 6;

const Hit = z.object({
  nodeTable: GraphTable,
  nodeId: z.uuid(),
  depth: z.number().int(),
  fromTable: GraphTable.nullable(),
  fromId: z.uuid().nullable(),
  via: z.string().nullable(),
  label: z.string(),
  status: z.string().nullable(),
});
type Hit = z.infer<typeof Hit>;

const keyOf = (table: string, id: string) => `${table}:${id}`;

export async function traceImpact(sql: Sql, worldId: string, start: NodeRef, maxDepth = 4): Promise<TraceNode[]> {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_TRACE_DEPTH) {
    throw new Error(`maxDepth must be an integer from 0 to ${MAX_TRACE_DEPTH}`);
  }
  const [found] = await sql`
    select 1 from twin_nodes
    where world_id = ${worldId} and node_table = ${start.table} and node_id = ${start.id}`;
  if (!found) throw new Error(`${start.table} ${start.id} does not exist in world ${worldId}`);

  const rows = await sql`
    with recursive walk (node_table, node_id, depth, from_table, from_id, via) as (
      select ${start.table}::text, ${start.id}::uuid, 0, null::text, null::uuid, null::text
      union
      select e.to_table, e.to_id, w.depth + 1, e.from_table, e.from_id, e.via
      from walk w
      join impact_edges e
        on e.world_id = ${worldId} and e.from_table = w.node_table and e.from_id = w.node_id
      where w.depth < ${maxDepth}
    ),
    nearest as (
      select *, min(depth) over (partition by node_table, node_id) as min_depth from walk
    )
    select n.node_table, n.node_id, n.depth, n.from_table, n.from_id, n.via, t.label, t.status
    from nearest n
    join twin_nodes t on t.world_id = ${worldId} and t.node_table = n.node_table and t.node_id = n.node_id
    where n.depth = n.min_depth
    order by n.depth, n.node_table, t.label, n.from_table, n.from_id`;

  // Keep one parent per node (the first in a stable order) so traces are deterministic.
  const best = new Map<string, Hit>();
  for (const row of rows) {
    const hit = Hit.parse(row);
    const key = keyOf(hit.nodeTable, hit.nodeId);
    if (!best.has(key)) best.set(key, hit);
  }

  const paths = new Map<string, NodeRef[]>();
  const pathTo = (hit: Hit): NodeRef[] => {
    const key = keyOf(hit.nodeTable, hit.nodeId);
    const cached = paths.get(key);
    if (cached) return cached;
    const self: NodeRef = { table: hit.nodeTable, id: hit.nodeId };
    let path: NodeRef[] = [self];
    if (hit.fromTable && hit.fromId) {
      const parent = best.get(keyOf(hit.fromTable, hit.fromId));
      // A parent at depth d-1 always exists for a node first reached at depth d.
      if (!parent) throw new Error(`Trace bug: missing parent for ${key}`);
      path = [...pathTo(parent), self];
    }
    paths.set(key, path);
    return path;
  };

  return [...best.values()].map((hit) =>
    TraceNode.parse({
      table: hit.nodeTable,
      id: hit.nodeId,
      label: hit.label,
      status: hit.status,
      depth: hit.depth,
      via: hit.via,
      path: pathTo(hit),
    }),
  );
}
