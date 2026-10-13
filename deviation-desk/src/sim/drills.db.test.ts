import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer } from "@/agents/contract";
import { closeSql, getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { applyEffect } from "./apply-effects";
import { endDrill, injectEffect, reverseSaboteurEffect, setDifficulty, startDrill } from "./drills";
import { readScenarioFiles, seedScenarioLibrary } from "./library";
import { runTick } from "./tick";

const sql = getSql();
let helix: SeededCompany;
let scenarioId: string;
let facilitator: string;

const start = (seed: number, over: Partial<Parameters<typeof startDrill>[1]> = {}) =>
  startDrill(sql, { companyId: helix.companyId, scenarioId, facilitatorPersonId: facilitator, difficulty: 5, agentsEnabled: false, secondsPerTick: 5, seed, ...over });

/** The team-visible effect log, minus ids and timestamps. */
const visible = (worldId: string) =>
  sql<{ tick: number; actor: string; effectType: string; targetLabel: string | null }[]>`
    select tick, actor, effect_type, target_label from sim_effects
    where world_id = ${worldId} and not hidden and effect_type not in ('started', 'tick') order by tick, id`;

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  await seedScenarioLibrary(sql, helix.companyId, readScenarioFiles(join(process.cwd(), "evals", "scenarios")));
  const [s] = await sql<{ id: string }[]>`select id from scenarios where company_id = ${helix.companyId} and title = 'Sterility failure on Line 3'`;
  if (!s) throw new Error("library not seeded");
  scenarioId = s.id;
  facilitator = await resolveRef(sql, helix.worldId, { table: "people", code: "Elena Duarte" });
});
afterAll(closeSql);

describe("starting a drill", () => {
  it("opens an incident in a new drill world, seats the facilitator, and leaves live untouched", async () => {
    const before = await sql`select count(*)::int as n from records where world_id = ${helix.worldId}`;
    const d = await start(11);
    const [incident] = await sql<{ code: string }[]>`select code from incidents where world_id = ${d.worldId}`;
    expect(incident?.code).toBe(d.incidentCode);
    const [seat] = await sql<{ role: string }[]>`select role from seats where world_id = ${d.worldId} and person_id = ${facilitator}`;
    expect(seat?.role).toBe("facilitator");
    expect(await sql`select count(*)::int as n from records where world_id = ${helix.worldId}`).toEqual(before);
    expect(d.emit).toEqual([]); // agents off
  });

  it("seeds the hidden spread once per object when the cause is also the trigger", async () => {
    const [gasket] = await sql<{ id: string }[]>`select id from scenarios where company_id = ${helix.companyId} and title = 'Gasket supplier delay'`;
    if (!gasket) throw new Error("library not seeded");
    const d = await start(12, { scenarioId: gasket.id });
    const seeds = await sql<{ targetLabel: string }[]>`
      select target_label from sim_effects where world_id = ${d.worldId} and effect_type = 'spread_seed'`;
    expect(seeds.map((s) => s.targetLabel)).toEqual(["Kestrel Seals"]);
  });

  it("refuses scenarios nobody approved", async () => {
    const [draft] = await sql<{ id: string }[]>`
      insert into scenarios ${sql({ companyId: helix.companyId, title: "Unapproved", spec: sql.json({}), source: "builder", approved: false })} returning id`;
    await expect(startDrill(sql, { companyId: helix.companyId, scenarioId: draft?.id ?? "", facilitatorPersonId: facilitator, difficulty: 1, agentsEnabled: false, secondsPerTick: 5 })).rejects.toThrow(/approve/);
  });
});

describe("ticks", () => {
  it("replay exactly from the same seed", async () => {
    const a = await start(4471);
    const b = await start(4471);
    for (let i = 0; i < 10; i++) {
      await runTick(sql, a.drillRunId);
      await runTick(sql, b.drillRunId);
    }
    const [la, lb] = [await visible(a.worldId), await visible(b.worldId)];
    expect(la.length).toBeGreaterThan(2); // the twist at tick 6 plus saboteur activity at difficulty 5
    expect(lb).toEqual(la);
    const hidden = (w: string) => sql`select tick, effect_type, target_label from sim_effects where world_id = ${w} and hidden and effect_type not in ('started', 'tick') order by tick, id`;
    expect(await hidden(b.worldId)).toEqual(await hidden(a.worldId));
  });

  it("move one tick at a time and advance the drill clock by an hour", async () => {
    const d = await start(5);
    const [before] = await sql<{ simClock: Date }[]>`select sim_clock from worlds where id = ${d.worldId}`;
    // Two clicks on the same "Step" both say they are advancing from tick 0.
    const [r1, r2] = await Promise.all([runTick(sql, d.drillRunId, 0), runTick(sql, d.drillRunId, 0)]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1); // a double click does not skip an hour
    const [after] = await sql<{ simClock: Date; tick: number }[]>`
      select w.sim_clock, d.tick from worlds w join drill_runs d on d.world_id = w.id where w.id = ${d.worldId}`;
    expect(after?.tick).toBe(1);
    expect((after?.simClock.getTime() ?? 0) - (before?.simClock.getTime() ?? 0)).toBe(3_600_000);
  });

  it("let an AI-played seat decide a pending proposal after a delay, then carry it out", async () => {
    const d = await start(21, { difficulty: 1 });
    const [incident] = await sql<{ id: string }[]>`select id from incidents where world_id = ${d.worldId}`;
    const batchId = await resolveRef(sql, d.worldId, { table: "batches", code: "A-2231" });
    const answer: AgentAnswer = {
      kind: "proposal",
      summary: "Hold A-2231",
      reasoning: "Failed sterility.",
      sources: [{ table: "batches", rowId: batchId, note: "A-2231" }],
      confidence: "high",
      alternatives: [],
      requiresApproval: true,
      approvalSeat: "qa_director",
      proposedAction: { type: "hold_batch", params: { batches: ["A-2231"], reason: "Failed sterility" } },
    };
    const [rec] = await sql<{ id: string }[]>`
      insert into decision_records ${sql({ worldId: d.worldId, companyId: helix.companyId, incidentId: incident?.id ?? null, agentId: "quarantine_officer", record: sql.json({ answer } as never), requiresApproval: true })}
      returning id`;
    await sql`insert into incident_events ${sql({ worldId: d.worldId, companyId: helix.companyId, incidentId: incident?.id ?? null, actorType: "system", actorId: "workflow", eventType: "approval_requested", payload: sql.json({ decisionRecordId: rec?.id ?? "", seat: "qa_director", actionType: "hold_batch" }) })}`;

    let decidedAt: number | null = null;
    for (let t = 1; t <= 6 && decidedAt === null; t++) {
      const r = await runTick(sql, d.drillRunId);
      if (r?.followUps.some((f) => f.data.decisionRecordId === rec?.id && f.data.outcome === "approved")) decidedAt = r.tick;
    }
    // Requested at hour 0: an AI seat takes one to three simulated hours, never zero.
    expect(decidedAt).toBeGreaterThanOrEqual(1);
    expect(decidedAt).toBeLessThanOrEqual(3);
    const [batch] = await sql<{ status: string }[]>`select status from batches where world_id = ${d.worldId} and batch_code = 'A-2231'`;
    expect(batch?.status).toBe("quarantined");

    // The approved hold is a team milestone: the saboteurs become frightened next tick.
    const next = await runTick(sql, d.drillRunId);
    expect(next?.mode).toBe("frightened");
  });
});

describe("facilitator controls", () => {
  it("inject events, reverse saboteur effects only while frightened, and bound difficulty", async () => {
    const d = await start(31);
    await injectEffect(sql, d.drillRunId, "equipment_fault", { table: "equipment", code: "Filler 4" });
    const [eq] = await sql<{ status: string }[]>`select status from equipment where world_id = ${d.worldId} and name = 'Filler 4'`;
    expect(eq?.status).toBe("failed");
    await expect(injectEffect(sql, d.drillRunId, "equipment_fault", { table: "rooms", code: "Dock" })).rejects.toThrow(/cannot target/);
    await expect(setDifficulty(sql, d.drillRunId, 9)).rejects.toThrow(/1 to 5/);

    const [{ simClock } = { simClock: new Date() }] = await sql<{ simClock: Date }[]>`select sim_clock from worlds where id = ${d.worldId}`;
    const roomId = await resolveRef(sql, d.worldId, { table: "rooms", code: "QC Lab" });
    const sabotage = await applyEffect(sql, { worldId: d.worldId, companyId: helix.companyId, tick: 0, simClock }, "wanderer", "em_spike", { table: "rooms", id: roomId, label: "QC Lab" });
    await expect(reverseSaboteurEffect(sql, d.drillRunId, sabotage.effectId)).rejects.toThrow(/frightened/);
  });

  it("never apply effects to a live world", async () => {
    const roomId = await resolveRef(sql, helix.worldId, { table: "rooms", code: "QC Lab" });
    await expect(
      applyEffect(sql, { worldId: helix.worldId, companyId: helix.companyId, tick: 0, simClock: new Date() }, "hunter", "em_spike", { table: "rooms", id: roomId, label: "QC Lab" }),
    ).rejects.toThrow(/drill world/);
  });
});

describe("ending", () => {
  it("scores the drill once and stops further ticks", async () => {
    const d = await start(41);
    for (let i = 0; i < 3; i++) await runTick(sql, d.drillRunId);
    const score = await endDrill(sql, d.drillRunId);
    expect(score.rootCauseCorrect).toBeNull(); // nobody proposed a cause (agents off)
    expect(score.spreadReached).toBeGreaterThanOrEqual(2);
    expect(await runTick(sql, d.drillRunId)).toBeNull();
    await expect(endDrill(sql, d.drillRunId)).rejects.toThrow(/already ended/);
    const [run] = await sql<{ score: { overall: number } | null }[]>`select score from drill_runs where id = ${d.drillRunId}`;
    expect(run?.score?.overall).toBe(score.overall);
  });
});
