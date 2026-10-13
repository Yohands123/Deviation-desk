import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAnswer, SeatRole } from "@/agents/contract";
import { tools } from "@/agents/tools";
import { executeApproved } from "@/approvals/executors";
import { recordApproval } from "@/approvals/record-approval";
import { takeSeat } from "@/approvals/seats";
import { closeSql, getSql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { SEED_ANCHOR, seedHelixBiologics, type SeededCompany } from "@/db/seed/helix-biologics";
import { deliverMessage, MAX_DELIVERY_ATTEMPTS, signPayload } from "./outbox";

const sql = getSql();
let helix: SeededCompany;
let drillWorldId: string;

async function incident(worldId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId: helix.companyId, code: `DEV-${crypto.randomUUID().slice(0, 6)}`, title: "Test", incidentType: "quality", severity: "critical" })}
    returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

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
      agentId: "comms_agent",
      record: sql.json({ agentId: "comms_agent", incidentId, worldId, answer, rejectedSources: [] } as never),
      requiresApproval: true,
    })}
    returning id`;
  if (!row) throw new Error("setup");
  return row.id;
}

/** Proposes, approves as an AI seat (drills only) and executes. */
async function approveAndRun(worldId: string, incidentId: string, type: string, params: Record<string, unknown>, seat: SeatRole) {
  const id = await proposal(worldId, incidentId, type, params, seat);
  await recordApproval(sql, { worldId, decisionRecordId: id, seat, personId: null, outcome: "approved" });
  return executeApproved(sql, worldId, id);
}

const QD1 = { ruleCode: "NMA-QD-1", reason: "Released batch A-2230 used the suspect gasket lot and was distributed." };
const submission = { to: ["NMA Quality Defects Unit"], subject: "Initial quality defect report: HLX-201", message: "Draft report.", ruleCode: "NMA-QD-1" };

beforeAll(async () => {
  helix = await seedHelixBiologics(sql, `Helix Biologics (test ${crypto.randomUUID().slice(0, 8)})`);
  drillWorldId = (await createDrillWorld(sql, helix.worldId, 5, { simClock: SEED_ANCHOR })).id;
});
afterAll(closeSql);

describe("reporting obligations", () => {
  it("computes the deadline from the rule, opens a task, and refuses a second confirmation", async () => {
    const incidentId = await incident(drillWorldId);
    const outcome = await approveAndRun(drillWorldId, incidentId, "confirm_reporting_obligation", QD1, "regulatory_affairs");
    expect(outcome.status).toBe("executed");
    expect(outcome.emit[0]).toMatchObject({ name: "obligation/confirmed", data: { ruleCode: "NMA-QD-1" } });

    // An eval-style drill world has no drill run, so awareness is its sim clock; QD-1 allows 72 hours.
    const [o] = await sql<{ clockStartedAt: Date; dueAt: Date; taskId: string }[]>`
      select clock_started_at, due_at, task_id from regulatory_obligations where world_id = ${drillWorldId} and incident_id = ${incidentId}`;
    expect(o?.clockStartedAt.toISOString()).toBe(SEED_ANCHOR.toISOString());
    expect(o?.dueAt.toISOString()).toBe(new Date(SEED_ANCHOR.getTime() + 72 * 3_600_000).toISOString());
    const [task] = await sql<{ ownerSeat: string; dueAt: Date }[]>`select owner_seat, due_at from tasks where world_id = ${drillWorldId} and id = ${o?.taskId ?? ""}`;
    expect(task?.ownerSeat).toBe("regulatory_affairs");

    const again = await approveAndRun(drillWorldId, incidentId, "confirm_reporting_obligation", QD1, "regulatory_affairs");
    expect(again).toMatchObject({ status: "failed", result: { reason: expect.stringMatching(/already confirmed/) } });
  });

  it("files a submission against a confirmed obligation only, closing its task; drill messages never send", async () => {
    const incidentId = await incident(drillWorldId);
    const early = await approveAndRun(drillWorldId, incidentId, "submit_notification", submission, "regulatory_affairs");
    expect(early).toMatchObject({ status: "failed", result: { reason: expect.stringMatching(/has not confirmed NMA-QD-1/) } });

    await approveAndRun(drillWorldId, incidentId, "confirm_reporting_obligation", QD1, "regulatory_affairs");
    const sent = await approveAndRun(drillWorldId, incidentId, "submit_notification", submission, "regulatory_affairs");
    expect(sent).toMatchObject({ status: "executed", result: { delivery: "drill" }, emit: [] });

    const [row] = await sql<{ status: string; recipients: Array<{ email: string }>; done: string }[]>`
      select m.status, m.recipients, t.status as done
      from regulatory_obligations o
      join outbound_messages m on m.world_id = o.world_id and m.id = o.submitted_message_id
      join tasks t on t.world_id = o.world_id and t.id = o.task_id
      where o.world_id = ${drillWorldId} and o.incident_id = ${incidentId}`;
    expect(row).toMatchObject({ status: "drill", done: "done" });
    expect(row?.recipients[0]?.email).toBe("quality-defects@nma.example");
  });

  it("fails a message whose recipient is not on file, and sends nothing", async () => {
    const incidentId = await incident(drillWorldId);
    const outcome = await approveAndRun(drillWorldId, incidentId, "notify_customer", { to: ["Unknown Clinic"], subject: "s", message: "m" }, "supply_chain_lead");
    expect(outcome).toMatchObject({ status: "failed", result: { reason: expect.stringMatching(/No customer contact on file for: unknown clinic/) } });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from outbound_messages where world_id = ${drillWorldId} and incident_id = ${incidentId}`;
    expect(n?.n).toBe(0);
  });

  it("routes a supplier request to the supplier's contact", async () => {
    const incidentId = await incident(drillWorldId);
    const outcome = await approveAndRun(
      drillWorldId,
      incidentId,
      "contact_supplier",
      { supplier: "Arbor Polymer Seals", material: "Filling-needle gasket, silicone", message: "Please quote an expedited order." },
      "supply_chain_lead",
    );
    expect(outcome.result).toMatchObject({ delivery: "drill", to: ["Nadia Petrov"] });
  });
});

describe("the outbox", () => {
  let liveMessageId: string;

  beforeAll(async () => {
    // A live message needs a person in the deciding seat.
    const incidentId = await incident(helix.worldId);
    const elena = await resolveRef(sql, helix.worldId, { table: "people", code: "Elena Duarte" });
    await takeSeat(sql, { worldId: helix.worldId, companyId: helix.companyId, incidentId, role: "qa_director", personId: elena });
    const id = await proposal(helix.worldId, incidentId, "notify_staff", { to: ["Daniel Brooks"], subject: "Brief", message: "Status brief." }, "qa_director");
    await recordApproval(sql, { worldId: helix.worldId, decisionRecordId: id, seat: "qa_director", personId: elena, outcome: "approved" });
    const outcome = await executeApproved(sql, helix.worldId, id);
    expect(outcome.emit[0]?.name).toBe("outbound/ready");
    liveMessageId = String(outcome.result.messageId);
  });

  it("keeps an approved message's content frozen and refuses deletes", async () => {
    await expect(sql`update outbound_messages set body = 'changed' where world_id = ${helix.worldId} and id = ${liveMessageId}`).rejects.toThrow(/cannot be changed/);
    await expect(sql`delete from outbound_messages where world_id = ${helix.worldId} and id = ${liveMessageId}`).rejects.toThrow(/append-only/);
  });

  it("posts a signed message to the webhook, retries failures, and gives up after the limit", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let fail = true;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response(null, { status: fail ? 503 : 200 });
    }) as unknown as typeof fetch;
    const opts = { url: "https://hooks.example/outbox", secret: "s3cret", fetchImpl };

    expect(await deliverMessage(sql, helix.worldId, liveMessageId, opts)).toBe("retry");
    fail = false;
    expect(await deliverMessage(sql, helix.worldId, liveMessageId, opts)).toBe("sent");
    expect(await deliverMessage(sql, helix.worldId, liveMessageId, opts)).toBe("skipped"); // already sent

    const last = calls.at(-1);
    expect(last?.headers["x-deviation-desk-signature"]).toBe(signPayload(last?.body ?? "", "s3cret"));
    expect(JSON.parse(last?.body ?? "{}")).toMatchObject({ subject: "Brief", recipients: [{ email: "daniel.brooks@helix.example" }] });
    const [m] = await sql<{ status: string; attempts: number }[]>`select status, attempts from outbound_messages where world_id = ${helix.worldId} and id = ${liveMessageId}`;
    expect(m).toEqual({ status: "sent", attempts: 2 });
  });

  it("marks messages not configured without a webhook, and failed after repeated errors", async () => {
    const make = async () => {
      const incidentId = await incident(helix.worldId);
      const elena = await resolveRef(sql, helix.worldId, { table: "people", code: "Elena Duarte" });
      await takeSeat(sql, { worldId: helix.worldId, companyId: helix.companyId, incidentId, role: "qa_director", personId: elena });
      const id = await proposal(helix.worldId, incidentId, "notify_staff", { to: ["Priya Raman"], subject: "s", message: "m" }, "qa_director");
      await recordApproval(sql, { worldId: helix.worldId, decisionRecordId: id, seat: "qa_director", personId: elena, outcome: "approved" });
      return String((await executeApproved(sql, helix.worldId, id)).result.messageId);
    };
    expect(await deliverMessage(sql, helix.worldId, await make(), { url: "" })).toBe("not_configured");

    const failing = await make();
    const down = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    for (let i = 1; i < MAX_DELIVERY_ATTEMPTS; i++) expect(await deliverMessage(sql, helix.worldId, failing, { url: "https://x.example", fetchImpl: down })).toBe("retry");
    expect(await deliverMessage(sql, helix.worldId, failing, { url: "https://x.example", fetchImpl: down })).toBe("failed");
  });
});

describe("regulatory tools", () => {
  const ctx = () => ({ worldId: drillWorldId, companyId: helix.companyId, incidentId: null, agentId: "test" });
  const call = async (name: string, input: unknown) => {
    const tool = tools[name];
    if (!tool) throw new Error(name);
    return (await tool.run(tool.input.parse(input), ctx())) as Record<string, unknown[]>;
  };

  it("searches the library by scope and keyword", async () => {
    const clinical = (await call("search_regulatory_library", { appliesTo: "clinical" })).rules as Array<{ code: string; fictional: boolean }>;
    expect(clinical.map((r) => r.code)).toEqual(["NMA-CT-4", "NMA-SD-5"]); // clinical, plus rules for all products
    expect(clinical.every((r) => r.fictional)).toBe(true);
    const defects = (await call("search_regulatory_library", { query: "distributed defect" })).rules as Array<{ code: string }>;
    expect(defects.map((r) => r.code)).toContain("NMA-QD-1");
  });

  it("lists contacts without their addresses", async () => {
    const sites = (await call("get_contacts", { kind: "trial_site" })).contacts as Array<Record<string, unknown>>;
    expect(sites.map((c) => c.organization)).toEqual(["Trial site 104 (study HLX-201-03)", "Trial site 212 (study HLX-201-04)"]);
    expect(sites[0]).not.toHaveProperty("email");
  });
});
