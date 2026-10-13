import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer } from "@/agents/contract";
import { executeApproved } from "@/approvals/executors";
import { recordApproval } from "@/approvals/record-approval";
import { closeSql, getSql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { SEED_ANCHOR, seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { optimizerIsUp } from "@/lib/optimizer";
import { applyTrigger } from "@/sim/triggers";
import { planOrder } from "./plan-order";

const sql = getSql();
let helix: SeededCompany;
let worldId: string;
let optimizerUp = false;

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  worldId = (await createDrillWorld(sql, helix.worldId, 11, { simClock: SEED_ANCHOR })).id;
  optimizerUp = await optimizerIsUp();
  if (!optimizerUp) console.warn("Optimizer not running (npm run optimizer); skipping order planning tests.");
});
afterAll(closeSql);

describe("an urgent order arriving", () => {
  it("logs the order with the next code and starts the Order Desk chain", async () => {
    const first = await applyTrigger(
      sql,
      { worldId, companyId: helix.companyId, simClock: SEED_ANCHOR },
      { type: "urgent_order", target: { table: "locations", code: "Northshore Hospital Pharmacy" }, atTick: 0, params: { quantity: 9000, dueInHours: 36, priority: "high" } },
    );
    const [order] = await sql<{ id: string; orderCode: string; dueAt: Date }[]>`select id, order_code, due_at from orders where world_id = ${worldId} and order_code = 'ORD-1048'`;
    expect(first).toEqual({ name: "order/received", data: { worldId, companyId: helix.companyId, orderId: order?.id } });
    expect(order?.dueAt.toISOString()).toBe(new Date(SEED_ANCHOR.getTime() + 36 * 3_600_000).toISOString());
  });
});

describe("planOrder", () => {
  it("serves the urgent trial order from released stock at the DC, on time", async (ctx) => {
    if (!optimizerUp) return ctx.skip();
    const plan = await planOrder(sql, worldId, "ORD-1045");
    expect(plan.target).toMatchObject({ onTime: true, lateHours: 0, sources: [{ label: "Released stock at Montreal DC", kind: "released_stock", units: 150 }] });
    // Physics: a new batch is filled at the next shift start and released only after its full test and QA review.
    expect(plan.newBatch?.fillStartsAt).toBe("2026-10-13T10:00:00.000Z");
    expect(plan.newBatch?.testEndsAt).toBe("2026-10-28T10:00:00.000Z");
    expect(plan.newBatch?.releasedAt).toBe("2026-10-29T10:00:00.000Z");
  });

  it("splits an order larger than released stock and shows it will be late, never sooner than testing allows", async (ctx) => {
    if (!optimizerUp) return ctx.skip();
    const plan = await planOrder(sql, worldId, "ORD-1048");
    // 6,600 released units, minus the patient-critical ORD-1045 served first; the rest waits for A-2231's QA release.
    expect(plan.target.sources.map((s) => s.kind)).toEqual(["released_stock", "released_stock", "in_testing"]);
    expect(plan.target.onTime).toBe(false);
    expect(plan.target.arrivesAt).toBe("2026-10-14T05:00:00.000Z");
    expect(plan.plan[0]?.orderCode).toBe("ORD-1045");
  });
});

describe("run_test", () => {
  it("turns an approved test into a QA task due when the method allows a result", async () => {
    const [incident] = await sql<{ id: string }[]>`
      insert into incidents ${sql({ worldId, companyId: helix.companyId, code: "DEV-T1", title: "Test", incidentType: "quality", severity: "critical" })} returning id`;
    const answer: AgentAnswer = {
      kind: "proposal",
      summary: "Swab Filler 3",
      reasoning: "Test.",
      sources: [{ table: "incidents", rowId: incident!.id, note: "n" }],
      confidence: "medium",
      alternatives: [],
      requiresApproval: true,
      approvalSeat: "qa_director",
      proposedAction: {
        type: "run_test",
        params: { test: "Swab the Filler 3 needle gasket and incubate", targets: ["Filler 3"], ifCauseConfirmed: "Growth matching the batch isolate", ifRuledOut: "No growth", durationHours: 72 },
      },
    };
    const [d] = await sql<{ id: string }[]>`
      insert into decision_records ${sql({ worldId, companyId: helix.companyId, incidentId: incident!.id, agentId: "trial_runner", record: sql.json({ agentId: "trial_runner", incidentId: incident!.id, worldId, answer, rejectedSources: [] } as never), requiresApproval: true })}
      returning id`;
    await recordApproval(sql, { worldId, decisionRecordId: d!.id, seat: "qa_director", personId: null, outcome: "approved" });
    const outcome = await executeApproved(sql, worldId, d!.id);
    expect(outcome.result).toMatchObject({ dueAt: new Date(SEED_ANCHOR.getTime() + 72 * 3_600_000).toISOString() });
    const [task] = await sql<{ title: string; ownerSeat: string }[]>`select title, owner_seat from tasks where world_id = ${worldId} and id = ${String(outcome.result.taskId)}`;
    expect(task).toEqual({ title: "Run test: Swab the Filler 3 needle gasket and incubate", ownerSeat: "qa_director" });
  });
});
