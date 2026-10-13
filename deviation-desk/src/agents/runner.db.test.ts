import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import type { CreateMessage, ModelResponse } from "./agent-loop";
import type { AgentAnswerWire } from "./answer-format";
import { getDefaultAgent as getAgent } from "./registry";
import { runAgent } from "./runner";
import { verifySources } from "./verify-sources";

const sql = getSql();
let helix: SeededCompany;
let other: SeededCompany;
let roomId: string;

const answerWith = (sources: AgentAnswerWire["sources"]): ModelResponse => ({
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 100 },
  content: [
    {
      type: "text",
      citations: null,
      text: JSON.stringify({
        kind: "finding",
        summary: "EM counts are rising in Fill Room 3.",
        reasoning: "Three increasing readings.",
        sources,
        confidence: "medium",
        confidenceScore: null,
        alternatives: [],
        requiresApproval: false,
        approvalSeat: null,
        proposedAction: null,
      } satisfies AgentAnswerWire),
    },
  ],
});

const modelReturning = (response: ModelResponse): { createMessage: CreateMessage; calls: () => number } => {
  let n = 0;
  return {
    createMessage: async () => {
      n++;
      return response;
    },
    calls: () => n,
  };
};

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  other = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  roomId = await resolveRef(sql, helix.worldId, { table: "rooms", code: "Fill Room 3" });
});
afterAll(closeSql);

describe("verifySources", () => {
  it("keeps real rows and rejects fabricated, foreign and uncitable ones", async () => {
    const foreignRoom = await resolveRef(sql, other.worldId, { table: "rooms", code: "Fill Room 3" });
    const { kept, rejected } = await verifySources(sql, helix.worldId, [
      { table: "rooms", rowId: roomId, note: "real" },
      { table: "rooms", rowId: crypto.randomUUID(), note: "made up" },
      { table: "rooms", rowId: foreignRoom, note: "other company" },
      { table: "batch_material_usage", rowId: roomId, note: "not citable" },
    ]);
    expect(kept.map((s) => s.note)).toEqual(["real"]);
    expect(rejected.map((s) => s.note)).toEqual(["made up", "other company", "not citable"]);
  });
});

describe("runAgent", () => {
  const ctx = () => ({ worldId: helix.worldId, companyId: helix.companyId, incidentId: null, agentId: "signal_watcher" });

  it("writes the run and its decision record", async () => {
    const model = modelReturning(answerWith([{ table: "rooms", rowId: roomId, note: "Fill Room 3" }]));
    const result = await runAgent({ agent: getAgent("signal_watcher"), ctx: ctx(), task: "t" }, model);

    const [run] = await sql<{ status: string; costUsd: string; incidentId: string | null }[]>`
      select status, cost_usd, incident_id from agent_runs where world_id = ${helix.worldId} and id = ${result.agentRunId}`;
    expect(run).toEqual({ status: "ok", costUsd: "0.0030", incidentId: null });
    const [decision] = await sql<{ record: { answer: { summary: string } } }[]>`
      select record from decision_records where world_id = ${helix.worldId} and id = ${result.decisionRecordId}`;
    expect(decision?.record.answer.summary).toBe("EM counts are rising in Fill Room 3.");
  });

  it("drops fabricated sources and keeps them on the record", async () => {
    const fake = { table: "records", rowId: crypto.randomUUID(), note: "invented cleaning record" };
    const model = modelReturning(answerWith([{ table: "rooms", rowId: roomId, note: "real" }, fake]));
    const result = await runAgent({ agent: getAgent("signal_watcher"), ctx: ctx(), task: "t" }, model);
    expect(result.record.answer.sources).toHaveLength(1);
    expect(result.record.rejectedSources).toEqual([fake]);
  });

  it("downgrades an answer whose sources are all fabricated", async () => {
    const model = modelReturning(answerWith([{ table: "rooms", rowId: crypto.randomUUID(), note: "made up" }]));
    const result = await runAgent({ agent: getAgent("signal_watcher"), ctx: ctx(), task: "t" }, model);
    expect(result.record.answer.kind).toBe("insufficient_evidence");
    expect(result.record.rejectedSources).toHaveLength(1);
  });

  it("does not call the model once the incident budget is spent", async () => {
    const [incident] = await sql<{ id: string }[]>`
      insert into incidents ${sql({ worldId: helix.worldId, companyId: helix.companyId, code: "DEV-B1", title: "Budget", incidentType: "quality", severity: "watch" })}
      returning id`;
    if (!incident) throw new Error("setup");
    await sql`insert into agent_runs ${sql({ worldId: helix.worldId, companyId: helix.companyId, incidentId: incident.id, agentId: "signal_watcher", model: "x", costUsd: "5.0000", status: "ok" })}`;

    const model = modelReturning(answerWith([]));
    const result = await runAgent(
      { agent: getAgent("signal_watcher"), ctx: { ...ctx(), incidentId: incident.id }, task: "t" },
      model,
    );
    expect(model.calls()).toBe(0);
    expect(result.status).toBe("budget_exceeded");
  });
});
