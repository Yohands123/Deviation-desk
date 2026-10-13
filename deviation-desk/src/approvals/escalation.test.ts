import { describe, expect, it } from "vitest";
import { escalationPlan } from "./escalation";

describe("escalationPlan", () => {
  it("notifies the executive, then marks the decision overdue, at the severity's pace", () => {
    expect(escalationPlan("qa_director", "critical")).toEqual([
      { wait: "30m", notify: "executive" },
      { wait: "30m", notify: null },
    ]);
  });

  it("has nobody above the executive", () => {
    expect(escalationPlan("executive", "warning")).toEqual([{ wait: "2h", notify: null }]);
  });
});
