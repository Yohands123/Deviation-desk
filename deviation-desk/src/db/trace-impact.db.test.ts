import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "./client";
import { resolveRef } from "./resolve-ref";
import type { GraphTable, NodeRef, TraceNode } from "./rows";
import { seedHelixBiologics, type SeededCompany } from "./seed/helix-biologics";
import { traceImpact } from "./trace-impact";

const sql = getSql();
let helix: SeededCompany;

const node = async (table: GraphTable, code: string): Promise<NodeRef> => ({
  table,
  id: await resolveRef(sql, helix.worldId, { table, code }),
});
const labels = (nodes: TraceNode[], table: GraphTable) =>
  nodes.filter((n) => n.table === table).map((n) => n.label).sort();
const find = (nodes: TraceNode[], table: GraphTable, label: string) =>
  nodes.find((n) => n.table === table && n.label === label);

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
});
afterAll(closeSql);

describe("traceImpact", () => {
  it("at depth 1 from A-2231 finds its lots, equipment and stock, but no other batch", async () => {
    const nodes = await traceImpact(sql, helix.worldId, await node("batches", "A-2231"), 1);
    expect(labels(nodes, "material_lots")).toEqual(["G-77", "ST-5502", "VL-3310"]);
    expect(labels(nodes, "equipment")).toEqual(["Capper 3", "Filler 3"]);
    expect(labels(nodes, "inventory_lots")).toEqual(["A-2231 @ Dock", "A-2231 @ Warehouse Bay B"]);
    expect(labels(nodes, "batches")).toEqual(["A-2231"]);
  });

  it("at depth 2 from A-2231 reaches A-2234 through a shared lot and SH-118 through dock stock", async () => {
    const nodes = await traceImpact(sql, helix.worldId, await node("batches", "A-2231"), 2);
    const a2234 = find(nodes, "batches", "A-2234");
    expect(a2234?.depth).toBe(2);
    // A-2234 shares G-77, ST-5502 and VL-3310 with A-2231; any of them is a valid shortest path.
    expect(a2234?.path[1]?.table).toBe("material_lots");
    const sh118 = find(nodes, "shipments", "SH-118");
    expect(sh118?.depth).toBe(2);
    expect(sh118?.via).toBe("shipped_in");
    expect(sh118?.path.map((p) => p.table)).toEqual(["batches", "inventory_lots", "shipments"]);
  });

  it("from gasket lot G-77 finds exactly the batches that used it", async () => {
    const nodes = await traceImpact(sql, helix.worldId, await node("material_lots", "G-77"), 1);
    expect(labels(nodes, "batches")).toEqual(["A-2230", "A-2231", "A-2232", "A-2234", "A-2235"]);
  });

  it("follows released A-2230 out to the customer that received it", async () => {
    const nodes = await traceImpact(sql, helix.worldId, await node("batches", "A-2230"), 4);
    const customer = find(nodes, "locations", "Northshore Hospital Pharmacy");
    expect(customer?.depth).toBe(3);
    expect(customer?.path.map((p) => p.table)).toEqual(["batches", "inventory_lots", "shipments", "locations"]);
    expect(find(nodes, "orders", "ORD-1044")?.status).toBe("allocated");
  });

  it("starts from a room through its equipment", async () => {
    const nodes = await traceImpact(sql, helix.worldId, await node("rooms", "Fill Room 3"), 1);
    expect(labels(nodes, "equipment")).toEqual(["Capper 3", "Filler 3"]);
  });

  it("returns each node once, with a consistent shortest path", async () => {
    const start = await node("batches", "A-2231");
    const nodes = await traceImpact(sql, helix.worldId, start, 6);
    const keys = nodes.map((n) => `${n.table}:${n.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of nodes) {
      expect(n.path).toHaveLength(n.depth + 1);
      expect(n.path[0]).toEqual(start);
      expect(n.path.at(-1)).toEqual({ table: n.table, id: n.id });
    }
    expect(nodes.filter((n) => n.depth === 0)).toHaveLength(1);
  });

  it("respects the depth limit", async () => {
    const start = await node("batches", "A-2231");
    expect(await traceImpact(sql, helix.worldId, start, 0)).toHaveLength(1);
    await expect(traceImpact(sql, helix.worldId, start, 7)).rejects.toThrow(/maxDepth/);
    await expect(traceImpact(sql, helix.worldId, start, -1)).rejects.toThrow(/maxDepth/);
  });

  it("never crosses into another company's world", async () => {
    const other = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
    const start = await node("batches", "A-2231");
    await expect(traceImpact(sql, other.worldId, start, 2)).rejects.toThrow(/does not exist/);
  });
});
