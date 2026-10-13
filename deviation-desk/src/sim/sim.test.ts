import { describe, expect, it } from "vitest";
import { aiSeatDecision } from "./ai-seats";
import { computeDrillScore, type DrillFacts } from "./drill-score";
import { describeEffect, normalizeEffectType } from "./effects";
import { modeAt } from "./modes";
import { createRng } from "./prng";
import { planSaboteurs, type SaboteurContext } from "./saboteurs";
import { canStillSpread, spreadStep, type SpreadEdge } from "./spread";

describe("modeAt", () => {
  it("cycles scatter then chase", () => {
    expect([0, 1, 2, 6, 7, 9].map((t) => modeAt(t, []))).toEqual(["scatter", "scatter", "chase", "chase", "scatter", "chase"]);
  });

  it("is frightened for three ticks after a team milestone", () => {
    expect([4, 5, 6, 7, 8].map((t) => modeAt(t, [4]))).toEqual(["chase", "frightened", "frightened", "frightened", "scatter"]);
  });
});

const ctx = (over: Partial<SaboteurContext> = {}): SaboteurContext => ({
  tick: 3,
  difficulty: 5,
  mode: "chase",
  focus: { table: "batches", id: "b1", label: "A-2231" },
  focusRoom: { table: "rooms", id: "r1", label: "Fill Room 3" },
  related: [{ table: "batches", id: "b2", label: "A-2234" }],
  plannedShipments: [{ table: "shipments", id: "s1", label: "SH-118" }],
  quietRooms: [{ table: "rooms", id: "r9", label: "QC Lab" }],
  ...over,
});

describe("planSaboteurs", () => {
  it("replays exactly from the same seed", () => {
    const run = () => Array.from({ length: 20 }, (_, t) => planSaboteurs(ctx({ tick: t, mode: modeAt(t, []) }), createRng(4471 + t)));
    expect(run()).toEqual(run());
  });

  it("does nothing while frightened", () => {
    for (let s = 0; s < 50; s++) expect(planSaboteurs(ctx({ mode: "frightened" }), createRng(s))).toEqual([]);
  });

  it("lets only the Wanderer act while scattering", () => {
    const actors = new Set(Array.from({ length: 200 }, (_, s) => planSaboteurs(ctx({ mode: "scatter" }), createRng(s)).map((e) => e.actor)).flat());
    expect([...actors]).toEqual(["wanderer"]);
  });

  it("aims each saboteur at its kind of target", () => {
    const effects = Array.from({ length: 300 }, (_, s) => planSaboteurs(ctx(), createRng(s))).flat();
    expect(effects.filter((e) => e.actor === "hunter").every((e) => e.type === "em_spike" && e.target.id === "r1")).toBe(true);
    expect(effects.filter((e) => e.actor === "ambusher").every((e) => e.type === "shipment_delay" && e.target.id === "s1")).toBe(true);
    expect(effects.filter((e) => e.actor === "wanderer").every((e) => e.type === "false_alarm")).toBe(true);
    expect(new Set(effects.map((e) => e.actor)).size).toBe(4);
  });

  it("acts more at higher difficulty", () => {
    const count = (difficulty: number) => Array.from({ length: 300 }, (_, s) => planSaboteurs(ctx({ difficulty }), createRng(s))).flat().length;
    expect(count(5)).toBeGreaterThan(count(1));
  });
});

describe("spread", () => {
  const edges: SpreadEdge[] = [
    { from: "lot:G77", to: "batch:A", kind: "material_lot" },
    { from: "lot:G77", to: "batch:B", kind: "material_lot" },
    { from: "batch:A", to: "ship:1", kind: "shipment" },
    { from: "batch:B", to: "eq:F4", kind: "equipment" },
  ];
  const kinds = new Set(["material_lot", "shipment"] as const);

  it("crosses only allowed, uncontained edges", () => {
    const affected = new Set(["lot:G77"]);
    expect(spreadStep(affected, edges, new Set(), kinds, 1, createRng(1))).toEqual(["batch:A", "batch:B"]);
    expect(spreadStep(affected, edges, new Set(["batch:B"]), kinds, 1, createRng(1))).toEqual(["batch:A"]);
  });

  it("replays exactly from the same seed", () => {
    const run = () => spreadStep(new Set(["lot:G77"]), edges, new Set(), kinds, 0.5, createRng(99));
    expect(run()).toEqual(run());
  });

  it("knows when containment has stopped it", () => {
    expect(canStillSpread(new Set(["lot:G77", "batch:A"]), edges, new Set(["batch:A", "batch:B"]), kinds)).toBe(false);
    expect(canStillSpread(new Set(["lot:G77"]), edges, new Set(), kinds)).toBe(true);
  });
});

describe("aiSeatDecision", () => {
  const pending = { decisionRecordId: "d1", seat: "qa_director", actionType: "hold_batch", requestedTick: 4, asks: 0 };

  it("waits at least a tick, and longer at shift change", () => {
    expect(aiSeatDecision(pending, 4, 10, 1)).toBeNull();
    const firstTick = (hour: number) => [5, 6, 7, 8].find((t) => aiSeatDecision(pending, t, hour, 1) !== null);
    expect(firstTick(7)).toBeGreaterThan(firstTick(10) ?? 0);
  });

  it("is the same decision every time for the same drill and proposal", () => {
    expect(aiSeatDecision(pending, 8, 10, 4471)).toEqual(aiSeatDecision(pending, 8, 10, 4471));
  });

  it("pushes back at most once", () => {
    for (let seed = 0; seed < 100; seed++) expect(aiSeatDecision({ ...pending, asks: 1 }, 9, 10, seed)?.outcome).toBe("approved");
  });
});

describe("effects", () => {
  it("accepts scenario aliases and describes what the team sees", () => {
    expect(normalizeEffectType("em_positive")).toBe("em_spike");
    expect(normalizeEffectType("teleport")).toBeNull();
    expect(describeEffect("shipment_delay", "SH-118")).toMatch(/SH-118/);
  });
});

describe("computeDrillScore", () => {
  const facts: DrillFacts = {
    hiddenTruth: { rootCause: "Worn gasket", causeObject: { table: "material_lots", code: "G-77" }, acceptableAnswers: ["worn gasket"] },
    rootCause: { summary: "A worn filling-needle gasket", cause: "", causeObject: { table: "material_lots", code: "G-77" }, accepted: true },
    durationTicks: 24,
    containWithinTicks: 8,
    containedAtTick: 6,
    spreadReached: 4,
    mustProtect: [{ code: "SH-118", reached: false }],
    decisions: [
      { seat: "qa_director", ticks: 1, byAi: false },
      { seat: "supply_chain_lead", ticks: 2, byAi: true },
    ],
    fabricatedSources: 0,
    costUsd: 0.51234,
  };

  it("scores a well-run drill full marks", () => {
    const s = computeDrillScore(facts);
    expect(s).toMatchObject({ rootCauseCorrect: true, containedInTime: true, protectedAll: true, overall: 100, costUsd: 0.512 });
  });

  it("takes points for late containment, a reached protected object and a wrong cause", () => {
    const s = computeDrillScore({
      ...facts,
      containedAtTick: 10,
      mustProtect: [{ code: "SH-118", reached: true }],
      rootCause: { ...facts.rootCause!, summary: "Missed cleaning", causeObject: null },
    });
    expect(s.rootCauseCorrect).toBe(false);
    expect(s.unprotected).toEqual(["SH-118"]);
    expect(s.overall).toBe(20 + 10 + 10); // late containment 30-10, speed, no fabrication
  });
});
