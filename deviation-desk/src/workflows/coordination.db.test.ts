import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer } from "@/agents/contract";
import { executeApproved } from "@/approvals/executors";
import { recordApproval } from "@/approvals/record-approval";
import { batchExposure, getCapacity, orderValues } from "@/db/capacity";
import { closeSql, getSql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { SEED_ANCHOR, seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { runLocally } from "./local-runner";

const sql = getSql();
let helix: SeededCompany;
let worldId: string;

async function incident(code: string, severity = "warning"): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId: helix.companyId, code, title: `Test ${code}`, incidentType: "supply", severity })}
    returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

async function approvedPause(incidentId: string, target: string) {
  const answer: AgentAnswer = {
    kind: "proposal",
    summary: "Pause",
    reasoning: "Test.",
    sources: [{ table: "incidents", rowId: incidentId, note: "n" }],
    confidence: "medium",
    alternatives: [],
    requiresApproval: true,
    approvalSeat: "executive",
    proposedAction: { type: "pause_incident", params: { incidentCode: target, reason: "The critical incident needs the dock and QA first." } },
  };
  const [d] = await sql<{ id: string }[]>`
    insert into decision_records ${sql({ worldId, companyId: helix.companyId, incidentId, agentId: "coordinator", record: sql.json({ agentId: "coordinator", incidentId, worldId, answer, rejectedSources: [] } as never), requiresApproval: true })}
    returning id`;
  await recordApproval(sql, { worldId, decisionRecordId: d!.id, seat: "executive", personId: null, outcome: "approved" });
  return executeApproved(sql, worldId, d!.id);
}

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  worldId = (await createDrillWorld(sql, helix.worldId, 9, { simClock: SEED_ANCHOR })).id;
});
afterAll(closeSql);

describe("capacity and costs", () => {
  it("computes resource load from the twin", async () => {
    const resources = await getCapacity(sql, worldId);
    const incubators = resources.find((r) => r.kind === "sterility_test");
    // A-2231, A-2232, A-2233 and A-2234 are in their sterility tests.
    expect(incubators).toMatchObject({ capacity: 12, capacityBasis: "concurrent", taskHours: 336, inUse: 4, free: 8 });
    // A-2235 is being filled on Line 3; Line 4 is free today.
    expect(resources.find((r) => r.lineName === "Line 3")).toMatchObject({ inUse: 1, free: 0 });
    expect(resources.find((r) => r.lineName === "Line 4")).toMatchObject({ inUse: 0, free: 1 });
  });

  it("prices where a batch's units are", async () => {
    const [a2230] = await batchExposure(sql, worldId, ["A-2230"]);
    // 1200 at Montreal DC: 600 already delivered (SH-115), 400 staged for Lakeview (SH-119).
    expect(a2230?.units).toEqual({ inStock: 1200, onHold: 0, staged: 400, inTransit: 0, delivered: 600 });
    expect(a2230?.valueUsd.delivered).toBe(228_000);
    const urgent = (await orderValues(sql, worldId)).find((o) => o.orderCode === "ORD-1045");
    expect(urgent).toMatchObject({ valueUsd: 57_000, covered: false, priority: "patient_critical" });
  });
});

describe("pausing an incident", () => {
  it("pauses on the Executive's approval, holds agent work, and refuses to pause twice", async () => {
    const critical = await incident("DEV-C1", "critical");
    const supply = await incident("DEV-S1");
    const outcome = await approvedPause(critical, "DEV-S1");
    expect(outcome).toMatchObject({ status: "executed", result: { paused: "DEV-S1", previousStatus: "open" } });
    const [row] = await sql<{ status: string }[]>`select status from incidents where world_id = ${worldId} and id = ${supply}`;
    expect(row?.status).toBe("paused");

    // Agent work for the paused incident does not run; a person's decision still would.
    const scope = { worldId, companyId: helix.companyId, incidentId: supply };
    const [skipped] = await runLocally({ name: "shortfall/detected", data: { ...scope, orderCode: "ORD-1045" } });
    expect(skipped?.handled).toBe(false);

    const again = await approvedPause(critical, "DEV-S1");
    expect(again).toMatchObject({ status: "failed", result: { reason: expect.stringMatching(/is paused; only open work/) } });

    await sql`update incidents set status = 'open' where world_id = ${worldId} and id = ${supply}`;
    const [resumed] = await runLocally({ name: "shortfall/detected", data: { ...scope, orderCode: "ORD-1045" } });
    expect(resumed?.handled).toBe(true);
  });
});
