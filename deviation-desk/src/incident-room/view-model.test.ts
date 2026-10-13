import { describe, expect, it } from "vitest";
import type { AgentCard } from "./types";
import {
  actionLabel,
  confidenceFill,
  consistentScore,
  decisionStatus,
  describeEvent,
  mergeFeed,
  pendingFor,
  roomTint,
  type ApprovalRow,
  type EventRow,
} from "./view-model";

const card = (over: Partial<AgentCard>): AgentCard => ({
  decisionRecordId: "d1",
  agentId: "quarantine_officer",
  agentName: "Quarantine Officer",
  createdAt: "2026-10-12T13:00:00Z",
  kind: "proposal",
  summary: "Hold A-2231",
  reasoning: "",
  confidence: "medium",
  confidenceScore: null,
  sources: [],
  alternatives: [],
  requiresApproval: true,
  approvalSeat: "qa_director",
  decidingSeats: ["qa_director", "plant_manager"],
  action: { type: "hold_batch", label: "Hold batches", params: {} },
  status: "pending",
  decision: null,
  rejectedSourceCount: 0,
  ...over,
});

const approval = (outcome: ApprovalRow["outcome"], at: string): ApprovalRow => ({
  decisionRecordId: "d1",
  outcome,
  seat: "qa_director",
  by: "Elena Duarte",
  reason: null,
  at,
});

describe("decisionStatus", () => {
  it("is none for findings and pending for undecided proposals", () => {
    expect(decisionStatus(false, []).status).toBe("none");
    expect(decisionStatus(true, []).status).toBe("pending");
  });

  it("keeps a proposal open when more evidence was asked for, until a final decision", () => {
    expect(decisionStatus(true, [approval("more_evidence", "1")]).status).toBe("more_evidence");
    expect(decisionStatus(true, [approval("more_evidence", "1"), approval("approved", "2")]).status).toBe("approved");
  });
});

describe("pendingFor", () => {
  it("lists open proposals the seat may decide", () => {
    const cards = [
      card({ decisionRecordId: "a" }),
      card({ decisionRecordId: "b", status: "approved" }),
      card({ decisionRecordId: "c", decidingSeats: ["supply_chain_lead"] }),
      card({ decisionRecordId: "d", status: "more_evidence" }),
    ];
    expect(pendingFor("plant_manager", cards).map((c) => c.decisionRecordId)).toEqual(["a", "d"]);
    expect(pendingFor(null, cards)).toEqual([]);
  });
});

describe("describeEvent", () => {
  const names = { people: new Map([["p1", "Priya Raman"]]), agents: new Map<string, string>() };
  const event = (over: Partial<EventRow>): EventRow => ({
    id: "1",
    at: "2026-10-12T13:00:00Z",
    actorType: "system",
    actorId: "workflow",
    seat: null,
    eventType: "opened",
    payload: {},
    ...over,
  });

  it("names the person and seat behind a human decision", () => {
    const item = describeEvent(
      event({ actorType: "human", actorId: "p1", seat: "plant_manager", eventType: "decision_recorded", payload: { outcome: "approved", actionType: "hold_batch" } }),
      names,
    );
    expect(item).toMatchObject({ actorKind: "human", actor: "Priya Raman (Plant Manager)", text: 'Approved "Hold batches".' });
  });

  it("marks AI-seat decisions as AI", () => {
    const item = describeEvent(event({ actorType: "system", actorId: "ai_seat", seat: "qa_director", eventType: "decision_recorded", payload: { outcome: "approved", actionType: "hold_batch" } }), names);
    expect(item?.actorKind).toBe("ai");
  });

  it("hides bookkeeping events", () => {
    expect(describeEvent(event({ eventType: "dedupe" }), names)).toBeNull();
  });
});

describe("small helpers", () => {
  it("labels actions in plain words", () => {
    expect(actionLabel("reroute_supply")).toBe("Reroute supply");
    expect(actionLabel("submit_notification")).toBe("Submit notification");
  });

  it("fills the confidence bar from the score, or the word", () => {
    expect(confidenceFill("high", 0.7)).toBe(0.7);
    expect(confidenceFill("low", null)).toBe(0.3);
  });

  it("ignores a score that contradicts the confidence word", () => {
    expect(consistentScore("medium", 0)).toBeNull();
    expect(confidenceFill("medium", 0)).toBe(0.6);
    expect(consistentScore("medium", 0.55)).toBe(0.55);
  });

  it("tints rooms by the worst signal", () => {
    expect(roomTint("clear", false, true)).toBe("at_risk");
    expect(roomTint("clear", true, true)).toBe("critical");
    expect(roomTint("watch", false, false)).toBe("at_risk");
    expect(roomTint("clear", false, false)).toBe("clear");
  });

  it("sorts the feed newest first", () => {
    const a = { id: "a", at: "2026-10-12T10:00:00Z", actorKind: "system" as const, actor: "", text: "", decisionRecordId: null };
    const b = { ...a, id: "b", at: "2026-10-12T11:00:00Z" };
    expect(mergeFeed([a], [b]).map((i) => i.id)).toEqual(["b", "a"]);
  });
});
