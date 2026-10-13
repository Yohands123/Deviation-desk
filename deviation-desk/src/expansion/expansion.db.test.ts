import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { optimizerIsUp } from "@/lib/optimizer";
import { Change } from "./change";
import { compareStress } from "./compare";
import { createProposal, decideProposal } from "./proposals";
import { simulateProposal } from "./simulate";

const sql = getSql();
let helix: SeededCompany;
let sofia: string;
let daniel: string;
let elena: string;
let optimizerUp = false;

const stoppers = { kind: "backup_supplier", material: "Vial stopper, 13 mm bromobutyl", supplier: "Westbrook Closures", country: "Canada", leadTimeDays: 40 };

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  const person = (name: string) => resolveRef(sql, helix.worldId, { table: "people", code: name });
  [sofia, daniel, elena] = await Promise.all([person("Sofia Lindqvist"), person("Daniel Brooks"), person("Elena Duarte")]);
  optimizerUp = await optimizerIsUp();
  if (!optimizerUp) console.warn("Optimizer not running (npm run optimizer); skipping simulations.");
});
afterAll(closeSql);

describe("proposals", () => {
  it("prices a change from the investment list and numbers proposals", async () => {
    const created = await createProposal(sql, helix.worldId, helix.companyId, { title: "Backup stopper supplier", summary: "s", change: stoppers }, "supplier_scout", null);
    expect(created).toMatchObject({ ok: true, code: "EXP-001", costUsd: 120_000 });
    const slots = await createProposal(sql, helix.worldId, helix.companyId, { title: "More incubators", summary: "s", change: { kind: "test_capacity", addSlots: 6 } }, "capacity_planner", null);
    expect(slots).toMatchObject({ ok: true, code: "EXP-002", costUsd: 270_000 });
  });

  it("rejects changes that do not fit the twin", async () => {
    const bad = await createProposal(sql, helix.worldId, helix.companyId, { title: "t", summary: "s", change: { kind: "fill_line", room: "Moon Base", lineName: "Line 3", unitsPerHour: 2400 } }, "capacity_planner", null);
    expect(bad).toEqual({ ok: false, problems: ['There is no room "Moon Base".', 'A line named "Line 3" already exists.'] });
    const gasket = await createProposal(sql, helix.worldId, helix.companyId, { title: "t", summary: "s", change: { ...stoppers, material: "Filling-needle gasket, silicone", supplier: "Arbor Polymer Seals" } }, "supplier_scout", null);
    expect(gasket).toEqual({ ok: false, problems: ["Arbor Polymer Seals is already approved for Filling-needle gasket, silicone."] });
  });
});

describe("decisions", () => {
  const propose = async (change: Record<string, unknown>) => {
    const p = await createProposal(sql, helix.worldId, helix.companyId, { title: "t", summary: "s", change }, "capacity_planner", null);
    if (!p.ok) throw new Error(p.problems.join("; "));
    return p.id;
  };

  it("lets Strategy & Growth approve spend under the threshold alone", async () => {
    const id = await propose({ kind: "test_capacity", addSlots: 2 }); // $90,000
    await expect(decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: daniel, outcome: "approved" })).rejects.toThrow(/under the spend threshold/);
    expect(await decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: sofia, outcome: "approved" })).toEqual({ status: "approved", waitingFor: null });
  });

  it("needs the Executive as well for larger spend, and a reason to reject", async () => {
    const id = await propose({ kind: "qa_capacity", addPerDay: 2 }); // $320,000
    expect(await decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: sofia, outcome: "approved" })).toEqual({ status: "proposed", waitingFor: "executive" });
    await expect(decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: daniel, outcome: "rejected" })).rejects.toThrow(/reason is required/);
    expect(await decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: daniel, outcome: "approved" })).toEqual({ status: "approved", waitingFor: null });
  });

  it("refuses people without a deciding standing seat", async () => {
    const id = await propose({ kind: "test_capacity", addSlots: 1 });
    await expect(decideProposal(sql, { worldId: helix.worldId, proposalId: id, personId: elena, outcome: "approved" })).rejects.toThrow(/Only Strategy & Growth or the Executive/);
  });
});

describe("simulate before you build", () => {
  it("shows a backup stopper supplier removing a single-source risk, leaving the live world untouched", async (ctx) => {
    if (!optimizerUp) return ctx.skip();
    const p = await createProposal(sql, helix.worldId, helix.companyId, { title: "t", summary: "s", change: { ...stoppers, supplier: "Harbor Closures" } }, "supplier_scout", null);
    if (!p.ok) throw new Error(p.problems.join("; "));
    const sim = await simulateProposal(sql, helix.worldId, helix.companyId, p.id, Change.parse({ ...stoppers, supplier: "Harbor Closures" }));
    expect(sim.baseline.singleSourceMaterials).toEqual(["Type I glass vial, 2 mL", "Vial stopper, 13 mm bromobutyl"]);
    expect(sim.withChange.singleSourceMaterials).toEqual(["Type I glass vial, 2 mL"]);
    expect(sim.baseline.orders).toHaveLength(3);
    // Nothing touched the live world: no new supplier, no stress orders, no halted line.
    const [n] = await sql<{ suppliers: number; orders: number; halted: number }[]>`
      select (select count(*) from suppliers where world_id = ${helix.worldId})::int as suppliers,
        (select count(*) from orders where world_id = ${helix.worldId})::int as orders,
        (select count(*) from production_lines where world_id = ${helix.worldId} and status = 'halted')::int as halted`;
    expect(n).toEqual({ suppliers: 4, orders: 6, halted: 0 });
  });

  it("shows an extra fill line keeping production going through an outage", async (ctx) => {
    if (!optimizerUp) return ctx.skip();
    const change = { kind: "fill_line", room: "Line 4", lineName: "Line 5", unitsPerHour: 2400 };
    const p = await createProposal(sql, helix.worldId, helix.companyId, { title: "t", summary: "s", change }, "capacity_planner", null);
    if (!p.ok) throw new Error(p.problems.join("; "));
    const sim = await simulateProposal(sql, helix.worldId, helix.companyId, p.id, Change.parse(change));
    expect(sim.baseline.capacity.fillLines).toBe(2);
    expect(sim.withChange.capacity.fillLines).toBe(3);
    expect(sim.withChange.outage.linesLeft).toBe(2);
    // The surge needs many new batches; with one line down, a third line still fills them sooner.
    const effect = compareStress(sim.baseline, sim.withChange).find((r) => r.measure.startsWith("Surge arrives with"));
    expect(effect?.effect).toBe("better");
  });
});
