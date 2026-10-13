import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer, SeatRole } from "@/agents/contract";
import { closeSql, getSql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { executeApproved } from "./executors";
import { recordApproval } from "./record-approval";
import { takeSeat } from "./seats";

const sql = getSql();
let helix: SeededCompany;
let drill: { worldId: string; companyId: string };
let priyaId: string;

async function incident(worldId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId: helix.companyId, code: `DEV-${crypto.randomUUID().slice(0, 6)}`, title: "Test", incidentType: "quality", severity: "critical" })}
    returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

/** A stored proposal, as an agent would have written it. */
async function proposal(worldId: string, incidentId: string, type: string, params: Record<string, unknown>, seat: SeatRole): Promise<string> {
  const answer: AgentAnswer = {
    kind: "proposal",
    summary: `Propose ${type}`,
    reasoning: "Test.",
    sources: [{ table: "incidents", rowId: incidentId, note: "The incident" }],
    confidence: "medium",
    alternatives: [],
    requiresApproval: true,
    approvalSeat: seat,
    proposedAction: { type, params },
  };
  const [row] = await sql<{ id: string }[]>`
    insert into decision_records ${sql({
      worldId,
      companyId: helix.companyId,
      incidentId,
      agentId: "quarantine_officer",
      record: sql.json({ agentId: "quarantine_officer", incidentId, worldId, answer, rejectedSources: [] } as never),
      requiresApproval: true,
    })}
    returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

const approveInDrill = (worldId: string, decisionRecordId: string, seat: SeatRole) =>
  recordApproval(sql, { worldId, decisionRecordId, seat, personId: null, outcome: "approved" });

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  drill = { worldId: (await createDrillWorld(sql, helix.worldId, 1)).id, companyId: helix.companyId };
  priyaId = await resolveRef(sql, helix.worldId, { table: "people", code: "Priya Raman" });
});
afterAll(closeSql);

describe("recordApproval", () => {
  it("refuses a seat that may not decide this action", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_batch", { batches: ["A-2231"], reason: "r" }, "qa_director");
    await expect(approveInDrill(drill.worldId, id, "supply_chain_lead")).rejects.toThrow(/cannot decide "hold_batch"/);
  });

  it("in a live world, needs a person who holds the seat on the incident", async () => {
    const incidentId = await incident(helix.worldId);
    const id = await proposal(helix.worldId, incidentId, "hold_batch", { batches: ["A-2231"], reason: "r" }, "plant_manager");
    const decide = (personId: string | null) =>
      recordApproval(sql, { worldId: helix.worldId, decisionRecordId: id, seat: "plant_manager", personId, outcome: "approved" });

    await expect(decide(null)).rejects.toThrow(/person must make this decision/);
    await expect(decide(priyaId)).rejects.toThrow(/does not hold the plant_manager seat/);
    await takeSeat(sql, { worldId: helix.worldId, companyId: helix.companyId, incidentId, role: "plant_manager", personId: priyaId });
    await expect(decide(priyaId)).resolves.toMatchObject({ actionType: "hold_batch" });
  });

  it("allows an AI seat in a drill, once", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_batch", { batches: ["A-2231"], reason: "r" }, "qa_director");
    await approveInDrill(drill.worldId, id, "qa_director");
    await expect(approveInDrill(drill.worldId, id, "qa_director")).rejects.toThrow(/already approved/);
  });

  it("needs a reason to reject", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_batch", { batches: ["A-2231"], reason: "r" }, "qa_director");
    await expect(
      recordApproval(sql, { worldId: drill.worldId, decisionRecordId: id, seat: "qa_director", personId: null, outcome: "rejected" }),
    ).rejects.toThrow(/reason is required/);
  });
});

describe("executeApproved", () => {
  it("refuses to act without an approval (principle 1)", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_batch", { batches: ["A-2231"], reason: "r" }, "qa_director");
    await expect(executeApproved(sql, drill.worldId, id)).rejects.toThrow(/no approval/);
  });

  it("holds batches and their stock, once, in the decision's world only", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_batch", { batches: ["A-2230", "A-2231"], reason: "G-77" }, "qa_director");
    await approveInDrill(drill.worldId, id, "qa_director");

    const first = await executeApproved(sql, drill.worldId, id);
    expect(first.status).toBe("executed");
    expect(first.emit[0]?.name).toBe("hold/approved");
    expect((await executeApproved(sql, drill.worldId, id)).status).toBe("already_executed");

    const status = (worldId: string) => sql<{ status: string; held: boolean }[]>`
      select b.status, bool_and(i.on_hold) as held from batches b join inventory_lots i on i.world_id = b.world_id and i.batch_id = b.id
      where b.world_id = ${worldId} and b.batch_code = 'A-2230' group by b.status`;
    expect(await status(drill.worldId)).toEqual([{ status: "quarantined", held: true }]);
    expect(await status(helix.worldId)).toEqual([{ status: "released", held: false }]);
  });

  it("holds shipments that can still be stopped, not delivered ones", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "hold_shipment", { shipments: ["SH-118", "SH-115"], reason: "r" }, "supply_chain_lead");
    await approveInDrill(drill.worldId, id, "supply_chain_lead");
    const outcome = await executeApproved(sql, drill.worldId, id);
    expect(outcome.result).toEqual({ held: ["SH-118"], notHeld: ["SH-115"] });
  });

  it("plans a shipment for a rerouted order from the oldest clean stock", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "reroute_supply", { orderCode: "ORD-1045", allocations: [{ location: "Montreal DC", quantity: 150 }] }, "supply_chain_lead");
    await approveInDrill(drill.worldId, id, "supply_chain_lead");
    const outcome = await executeApproved(sql, drill.worldId, id);
    expect(outcome.status).toBe("executed");

    const [shipment] = await sql<{ status: string; batchCode: string; quantity: number; orderStatus: string }[]>`
      select s.status, b.batch_code, si.quantity, o.status as order_status
      from shipments s
      join orders o on o.world_id = s.world_id and o.id = s.order_id
      join shipment_items si on si.world_id = s.world_id and si.shipment_id = s.id
      join inventory_lots i on i.world_id = si.world_id and i.id = si.inventory_lot_id
      join batches b on b.world_id = i.world_id and b.id = i.batch_id
      where s.world_id = ${drill.worldId} and o.order_code = 'ORD-1045'`;
    expect(shipment).toEqual({ status: "planned", batchCode: "A-2227", quantity: 150, orderStatus: "allocated" });
  });

  it("records a failure and changes nothing when the plan no longer fits the stock", async () => {
    const id = await proposal(drill.worldId, await incident(drill.worldId), "reroute_supply", { orderCode: "ORD-1046", allocations: [{ location: "Montreal DC", quantity: 999_999 }] }, "supply_chain_lead");
    await approveInDrill(drill.worldId, id, "supply_chain_lead");
    const before = await sql`select count(*)::int as n from shipments where world_id = ${drill.worldId}`;
    const outcome = await executeApproved(sql, drill.worldId, id);
    expect(outcome.status).toBe("failed");
    expect(await sql`select count(*)::int as n from shipments where world_id = ${drill.worldId}`).toEqual(before);
  });
});
