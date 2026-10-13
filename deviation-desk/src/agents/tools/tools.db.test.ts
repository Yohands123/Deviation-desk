import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { tools } from ".";
import type { ToolContext } from "./types";

const sql = getSql();
let helix: SeededCompany;
let other: SeededCompany;
let ctx: ToolContext;

/** Calls a tool the way the loop does: validate input, then run with the runner's context. */
async function call(name: string, input: unknown, context: ToolContext = ctx): Promise<Record<string, unknown>> {
  const tool = tools[name];
  if (!tool) throw new Error(`no tool ${name}`);
  return (await tool.run(tool.input.parse(input), context)) as Record<string, unknown>;
}

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  other = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  ctx = { worldId: helix.worldId, companyId: helix.companyId, incidentId: null, agentId: "test" };
});
afterAll(closeSql);

describe("query_twin", () => {
  it("filters by allowed columns, in snake or camel case", async () => {
    const snake = await call("query_twin", { table: "batches", filters: { batch_code: "A-2231" } });
    const camel = await call("query_twin", { table: "batches", filters: { batchCode: "A-2231" } });
    expect(snake.rows).toHaveLength(1);
    expect(camel.rows).toEqual(snake.rows);
  });

  it("refuses columns outside the allow-list", async () => {
    await expect(call("query_twin", { table: "batches", filters: { world_id: helix.worldId } })).rejects.toThrow(/Cannot filter/);
  });

  it("only sees the runner's world", async () => {
    const otherId = await resolveRef(sql, other.worldId, { table: "batches", code: "A-2231" });
    const result = await call("query_twin", { table: "batches", filters: { id: otherId } });
    expect(result.rows).toEqual([]);
  });
});

describe("trace_impact", () => {
  it("starts from a code", async () => {
    const result = await call("trace_impact", { startTable: "material_lots", startCode: "G-77", maxDepth: 1 });
    const labels = (result.nodes as Array<{ label: string; table: string }>).filter((n) => n.table === "batches").map((n) => n.label);
    expect(labels.sort()).toEqual(["A-2230", "A-2231", "A-2232", "A-2234", "A-2235"]);
  });

  it("rejects an id from another world", async () => {
    const otherId = await resolveRef(sql, other.worldId, { table: "batches", code: "A-2231" });
    await expect(call("trace_impact", { startTable: "batches", startId: otherId })).rejects.toThrow(/No batches row/);
  });
});

describe("record and sensor tools", () => {
  it("search_sops finds the cleaning SOP", async () => {
    const result = await call("search_sops", { query: "cleanroom cleaning" });
    const titles = (result.sops as Array<{ title: string }>).map((s) => s.title);
    expect(titles[0]).toMatch(/SOP-CL-012/);
  });

  it("get_sensor_history returns readings oldest first with thresholds", async () => {
    const result = await call("get_sensor_history", { subjectTable: "rooms", subjectCode: "Fill Room 3", metric: "em_cfu" });
    const values = (result.readings as Array<{ value: number }>).map((r) => r.value);
    expect(values).toHaveLength(30);
    expect(values.slice(-4)).toEqual([0, 1, 2, 3]);
    expect(result.thresholds).toEqual({ alert: 1, action: 3 });
  });

  it("get_records returns Filler 3 maintenance with the gasket-wear note", async () => {
    const result = await call("get_records", { subjectTable: "equipment", subjectCode: "Filler 3", recordType: "maintenance" });
    const bodies = (result.records as Array<{ body: string }>).map((r) => r.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatch(/wear on filling-needle gasket/);
  });
});

describe("incident tools", () => {
  it("need an incident on the run", async () => {
    await expect(call("get_incident", {})).rejects.toThrow(/not attached/);
    await expect(call("list_evidence", {})).rejects.toThrow(/not attached/);
  });

  it("read the run's incident, its evidence, and open incidents with their objects", async () => {
    const [incident] = await sql<{ id: string }[]>`
      insert into incidents ${sql({ worldId: helix.worldId, companyId: helix.companyId, code: "DEV-T1", title: "Test", incidentType: "quality", severity: "critical" })}
      returning id`;
    if (!incident) throw new Error("setup");
    await sql`insert into incident_events ${sql({
      worldId: helix.worldId,
      companyId: helix.companyId,
      incidentId: incident.id,
      actorType: "system",
      actorId: "test",
      eventType: "opened",
      payload: sql.json({ objects: [{ table: "batches", code: "A-2231" }] }),
    })}`;
    await sql`insert into evidence ${sql({ worldId: helix.worldId, companyId: helix.companyId, incidentId: incident.id, sourceTable: "records", sourceId: "x", addedByType: "agent", addedBy: "test", note: "n" })}`;
    const withIncident = { ...ctx, incidentId: incident.id };

    const got = await call("get_incident", {}, withIncident);
    expect((got.incident as { code: string }).code).toBe("DEV-T1");
    expect(((await call("list_evidence", {}, withIncident)).evidence as unknown[]).length).toBe(1);
    const open = (await call("find_open_incidents", {})).incidents as Array<{ code: string; objects: unknown }>;
    expect(open.find((i) => i.code === "DEV-T1")?.objects).toEqual([{ table: "batches", code: "A-2231" }]);
  });
});

describe("list_agents", () => {
  it("lists the registered agents", async () => {
    const result = await call("list_agents", {});
    expect((result.agents as Array<{ id: string }>).map((a) => a.id)).toContain("root_cause_analyst");
  });
});
