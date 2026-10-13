import { describe, expect, it } from "vitest";
import { aggregate, matchesRootCause, missingAgents, namesCauseObject, passed, type Score } from "./score";

const base: Score = {
  id: "s",
  rootCauseCorrect: true,
  citesCauseObject: true,
  agentsMissing: [],
  fabricatedSources: 0,
  costUsd: 0,
  durationMs: 0,
  ticksToContain: null,
  spreadReached: null,
  skippedSopSteps: null,
  error: null,
};

describe("matchesRootCause", () => {
  const acceptable = ["worn gasket", "gasket lot G-77", "Filler 3 gasket"];

  it("accepts any acceptable phrasing, ignoring case, word order, extra words and dash style", () => {
    expect(matchesRootCause("The likely cause is a WORN  gasket on the filler.", acceptable)).toBe(true);
    expect(matchesRootCause("Contamination traced to gasket lot G–77.", acceptable)).toBe(true);
    expect(matchesRootCause("A worn filling-needle gasket on Filler 3 (lot G-77) broke the seal.", acceptable)).toBe(true);
  });

  it("rejects a different cause", () => {
    expect(matchesRootCause("Inadequate cleaning on Oct 9 caused the failure.", acceptable)).toBe(false);
    expect(matchesRootCause("The gasket on Filler 4 is fine; cleaning was missed.", acceptable)).toBe(false);
  });
});

describe("namesCauseObject", () => {
  const truth = { table: "material_lots", code: "G-77" };

  it("matches the hidden truth's object", () => {
    expect(namesCauseObject({ table: "material_lots", code: "g-77" }, truth)).toBe(true);
  });

  it("rejects another object or a malformed value", () => {
    expect(namesCauseObject({ table: "rooms", code: "Fill Room 3" }, truth)).toBe(false);
    expect(namesCauseObject("G-77", truth)).toBe(false);
    expect(namesCauseObject(undefined, truth)).toBe(false);
  });
});

describe("scoring", () => {
  it("lists required agents that did not run", () => {
    expect(missingAgents(["a", "b", "c"], ["b", "x"])).toEqual(["a", "c"]);
  });

  it("fails a scenario on any fabricated source, missing agent, wrong cause or error", () => {
    expect(passed(base)).toBe(true);
    expect(passed({ ...base, fabricatedSources: 1 })).toBe(false);
    expect(passed({ ...base, agentsMissing: ["devils_advocate"] })).toBe(false);
    expect(passed({ ...base, rootCauseCorrect: false })).toBe(false);
    expect(passed({ ...base, error: "boom" })).toBe(false);
  });

  it("aggregates as the share of passing scenarios", () => {
    expect(aggregate([base, { ...base, rootCauseCorrect: false }])).toBe(0.5);
    expect(aggregate([])).toBe(0);
  });
});
