import { describe, expect, it } from "vitest";
import { compareStress } from "./compare";
import type { StressResult } from "./simulate";

const run = (over: Partial<StressResult> = {}): StressResult => ({
  orders: [{ name: "Surge", quantity: 40000, dueAt: "2026-11-10T00:00:00Z", arrivesAt: "2026-11-05T06:00:00Z", lateHours: 0, onTime: true }],
  onTime: 1,
  lateHours: 0,
  unmet: 0,
  outage: { haltedLine: "Line 3", linesLeft: 1, surgeArrivesAt: "2026-11-10T06:00:00Z", surgeLateHours: 0 },
  singleSourceMaterials: ["Vial", "Stopper"],
  capacity: { fillLines: 2, testSlots: 12, qaReviewsPerDay: 2 },
  ...over,
});

describe("compareStress", () => {
  it("reports days sooner, counts and the direction of each effect", () => {
    const rows = compareStress(run(), run({ outage: { haltedLine: "Line 3", linesLeft: 2, surgeArrivesAt: "2026-11-05T06:00:00Z", surgeLateHours: 0 }, singleSourceMaterials: ["Vial"] }));
    expect(rows.find((r) => r.measure.startsWith("Surge arrives with"))).toMatchObject({ effect: "better", note: "5 days sooner", baseline: "2026-11-10", withChange: "2026-11-05" });
    expect(rows.find((r) => r.measure === "Single-source materials")).toMatchObject({ effect: "better", note: "-1" });
    expect(rows.find((r) => r.measure === "QA batch reviews per day")).toMatchObject({ effect: "same", note: "" });
  });

  it("treats arrivals within the hour as the same", () => {
    const rows = compareStress(run(), run({ orders: [{ name: "Surge", quantity: 40000, dueAt: "x", arrivesAt: "2026-11-05T06:00:40Z", lateHours: 0, onTime: true }] }));
    expect(rows[0]).toMatchObject({ effect: "same" });
  });
});
