import { describe, expect, it } from "vitest";
import { isUrgent } from "./orders";

const now = new Date("2026-10-12T13:00:00Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("isUrgent", () => {
  it("treats patient-critical or soon-due orders without supply as urgent", () => {
    expect(isUrgent({ priority: "patient_critical", dueAt: inHours(500) }, false, now)).toBe(true);
    expect(isUrgent({ priority: "routine", dueAt: inHours(48) }, false, now)).toBe(true);
    expect(isUrgent({ priority: "high", dueAt: inHours(200) }, false, now)).toBe(false);
  });

  it("never treats a covered order as urgent", () => {
    expect(isUrgent({ priority: "patient_critical", dueAt: inHours(10) }, true, now)).toBe(false);
  });
});
