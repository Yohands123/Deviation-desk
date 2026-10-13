import { describe, expect, it } from "vitest";
import { AgentAnswer } from "./contract";

const finding = {
  kind: "finding",
  summary: "EM counts in Fill Room 3 rose for three consecutive days.",
  reasoning: "Readings climbed from 0 to 2 CFU over the last three days.",
  sources: [{ table: "sensor_readings", rowId: "r-1", note: "Latest EM swab" }],
  confidence: "medium",
  requiresApproval: false,
} as const;

describe("AgentAnswer", () => {
  it("accepts a sourced finding and defaults alternatives to []", () => {
    const parsed = AgentAnswer.parse(finding);
    expect(parsed.alternatives).toEqual([]);
  });

  it("rejects a finding with no sources (principle 3)", () => {
    expect(AgentAnswer.safeParse({ ...finding, sources: [] }).success).toBe(false);
  });

  it("allows insufficient_evidence without sources", () => {
    const result = AgentAnswer.safeParse({
      ...finding,
      kind: "insufficient_evidence",
      confidence: "insufficient",
      sources: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an approval request without a seat and action (principle 1)", () => {
    expect(AgentAnswer.safeParse({ ...finding, kind: "proposal", requiresApproval: true }).success).toBe(false);
  });

  it("accepts an approval request with a seat and action", () => {
    const result = AgentAnswer.safeParse({
      ...finding,
      kind: "proposal",
      requiresApproval: true,
      approvalSeat: "qa_director",
      proposedAction: { type: "hold_batch", params: { batch: "A-2231" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a confidence score outside 0..1", () => {
    expect(AgentAnswer.safeParse({ ...finding, confidenceScore: 1.5 }).success).toBe(false);
  });
});
