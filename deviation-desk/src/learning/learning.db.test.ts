import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer } from "@/agents/contract";
import { recordApproval } from "@/approvals/record-approval";
import { takeSeat } from "@/approvals/seats";
import { closeSql, getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { auditChecks } from "@/oversight/audit-checks";
import { activeLessons, decideLesson, lessonsBlock, proposeLesson } from "./lessons";
import { pushback, trackRecords } from "./track-records";

const sql = getSql();
let helix: SeededCompany;
let tomas: string;
let elena: string;
let sofia: string;

async function incident(code: string, over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId: helix.worldId, companyId: helix.companyId, code, title: `Test ${code}`, incidentType: "quality", severity: "critical", ...over })} returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

async function record(incidentId: string, agentId: string, rejectedSources = 0): Promise<string> {
  const answer: AgentAnswer = {
    kind: "proposal",
    summary: "Hold SH-115",
    reasoning: "Test.",
    sources: [{ table: "incidents", rowId: incidentId, note: "n" }],
    confidence: "medium",
    alternatives: [],
    requiresApproval: true,
    approvalSeat: "supply_chain_lead",
    proposedAction: { type: "hold_shipment", params: { shipments: ["SH-115"], reason: "r" } },
  };
  const rejected = Array.from({ length: rejectedSources }, () => ({ table: "batches", rowId: "00000000-0000-0000-0000-000000000000", note: "made up" }));
  const [d] = await sql<{ id: string }[]>`
    insert into decision_records ${sql({ worldId: helix.worldId, companyId: helix.companyId, incidentId, agentId, record: sql.json({ agentId, incidentId, worldId: helix.worldId, answer, rejectedSources: rejected } as never), requiresApproval: true })}
    returning id`;
  if (!d) throw new Error("setup");
  return d.id;
}

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  const person = (name: string) => resolveRef(sql, helix.worldId, { table: "people", code: name });
  [tomas, elena, sofia] = await Promise.all([person("Tomás Reyes"), person("Elena Duarte"), person("Sofia Lindqvist")]);
});
afterAll(closeSql);

describe("track records and pushback", () => {
  it("counts people's decisions per agent and lists the reasons they gave", async () => {
    const incidentId = await incident("DEV-L1");
    await takeSeat(sql, { worldId: helix.worldId, companyId: helix.companyId, incidentId, role: "supply_chain_lead", personId: tomas });
    const rejected = await record(incidentId, "quarantine_officer", 1);
    const approved = await record(incidentId, "quarantine_officer");
    await recordApproval(sql, { worldId: helix.worldId, decisionRecordId: rejected, seat: "supply_chain_lead", personId: tomas, outcome: "rejected", reason: "SH-115 was delivered." });
    await recordApproval(sql, { worldId: helix.worldId, decisionRecordId: approved, seat: "supply_chain_lead", personId: tomas, outcome: "approved" });

    const officer = (await trackRecords(sql, helix.companyId, "live")).find((r) => r.agentId === "quarantine_officer");
    expect(officer).toMatchObject({ proposals: 2, approved: 1, rejected: 1, overridden: 0, pending: 0, approvalRate: 0.5, fabricatedSources: 1 });
    const items = await pushback(sql, helix.worldId);
    expect(items).toEqual([expect.objectContaining({ decisionRecordId: rejected, agentId: "quarantine_officer", outcome: "rejected", reason: "SH-115 was delivered.", seat: "supply_chain_lead" })]);
  });
});

describe("lessons", () => {
  it("reach an agent only after the QA Director or Executive approves, and can be retired", async () => {
    const incidentId = await incident("DEV-L2");
    const source = await record(incidentId, "learning_loop");
    const proposed = await proposeLesson(sql, helix.worldId, helix.companyId, source, {
      agentId: "quarantine_officer",
      lesson: "Never propose holding a delivered shipment; flag it for a recall assessment instead.",
      rationale: "Rejected three times for the same reason.",
      evidence: [source],
    });
    if (!proposed.ok) throw new Error(proposed.problem);
    expect(await proposeLesson(sql, helix.worldId, helix.companyId, source, { agentId: "quarantine_officer", lesson: "x", rationale: "y", evidence: [] })).toMatchObject({ ok: false });
    expect(await activeLessons(sql, helix.companyId, "quarantine_officer")).toEqual([]);

    await expect(decideLesson(sql, { worldId: helix.worldId, lessonId: proposed.id, personId: sofia, outcome: "active" })).rejects.toThrow(/Only the QA Director or the Executive/);
    await decideLesson(sql, { worldId: helix.worldId, lessonId: proposed.id, personId: elena, outcome: "active" });
    const lessons = await activeLessons(sql, helix.companyId, "quarantine_officer");
    expect(lessons).toEqual(["Never propose holding a delivered shipment; flag it for a recall assessment instead."]);
    expect(lessonsBlock(lessons)).toContain("- Never propose holding a delivered shipment");

    await expect(decideLesson(sql, { worldId: helix.worldId, lessonId: proposed.id, personId: elena, outcome: "retired" })).rejects.toThrow(/reason is required/);
    await decideLesson(sql, { worldId: helix.worldId, lessonId: proposed.id, personId: elena, outcome: "retired", reason: "Covered by the new SOP." });
    expect(await activeLessons(sql, helix.companyId, "quarantine_officer")).toEqual([]);
    const history = await sql<{ outcome: string }[]>`select outcome from agent_lesson_decisions where world_id = ${helix.worldId} and lesson_id = ${proposed.id} order by created_at`;
    expect(history.map((h) => h.outcome)).toEqual(["active", "retired"]);
  });

  it("refuses lessons for agents that do not exist", async () => {
    const incidentId = await incident("DEV-L3");
    const source = await record(incidentId, "learning_loop");
    expect(await proposeLesson(sql, helix.worldId, helix.companyId, source, { agentId: "nobody", lesson: "x", rationale: "y", evidence: [] })).toEqual({ ok: false, problem: 'There is no agent "nobody".' });
  });
});

describe("audit checks", () => {
  it("flag unowned and overdue work, an empty QA seat on a critical incident, and a reporting deadline close at hand", async () => {
    const incidentId = await incident("DEV-A1", { openedAt: new Date(Date.now() - 3 * 3_600_000) });
    const scope = { worldId: helix.worldId, companyId: helix.companyId, incidentId };
    await sql`insert into tasks ${sql([
      { ...scope, title: "Collect batch records", ownerSeat: null, dueAt: null },
      { ...scope, title: "Swab Filler 3", ownerSeat: "qa_director", dueAt: new Date(Date.now() - 3_600_000) },
    ])}`;
    const flags = await auditChecks(sql, helix.worldId, incidentId);
    expect(flags.map((f) => f.text)).toEqual([
      'Task "Collect batch records" has no owner seat.',
      expect.stringMatching(/^Task "Swab Filler 3" \(qa_director\) was due .* and is still open\.$/),
      "Critical incident DEV-A1 has been open over an hour with no person in the QA Director seat.",
    ]);
    await takeSeat(sql, { ...scope, role: "qa_director", personId: elena });
    expect((await auditChecks(sql, helix.worldId, incidentId)).some((f) => f.key === "no-qa-director")).toBe(false);
  });
});
