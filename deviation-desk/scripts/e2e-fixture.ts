/**
 * Playwright's throwaway company, logins and deterministic Phase 7 records. No model calls.
 * Prints one JSON line; --archive retires only an e2e company's live world after the tests.
 */
import { AgentAnswer, type AgentAnswer as Answer } from "../src/agents/contract";
import { NO_INCIDENT_DAILY_RUNS } from "../src/agents/persist";
import { executeApproved } from "../src/approvals/executors";
import { recordApproval } from "../src/approvals/record-approval";
import { takeSeat } from "../src/approvals/seats";
import { closeSql, getSql } from "../src/db/client";
import { resolveRef } from "../src/db/resolve-ref";
import { createDemoLogins, DEMO_PASSWORD } from "../src/db/seed/demo-logins";
import { seedHelixBiologics } from "../src/db/seed/helix-biologics";
import { createProposal } from "../src/expansion/proposals";
import { simulateProposal, type StressResult } from "../src/expansion/simulate";
import { proposeLesson } from "../src/learning/lessons";
import { optimizerIsUp } from "../src/lib/optimizer";
import { readScenarioFiles, seedScenarioLibrary } from "../src/sim/library";
import { join } from "node:path";

async function main() {
  const sql = getSql();
  if (process.argv[2] === "--archive") {
    const worldId = process.argv[3];
    if (!worldId) throw new Error("An e2e world id is required to archive it.");
    const rows = await sql`
      update worlds w set status = 'archived' from companies c
      where w.id = ${worldId} and w.company_id = c.id and w.kind = 'live'
        and c.name like 'Helix Biologics (e2e %)'
      returning w.id`;
    if (rows.length !== 1) throw new Error("Refusing to archive a world outside the e2e fixture.");
    const [modelUsage] = await sql`
      select r.id from agent_runs r
      where r.company_id = (select company_id from worlds where id = ${worldId})
        and r.model <> 'e2e-budget-guard'
        and (coalesce(r.cost_usd, 0) > 0 or coalesce(r.input_tokens, 0) > 0 or coalesce(r.output_tokens, 0) > 0)
      limit 1`;
    if (modelUsage) throw new Error("The e2e company recorded model usage; tests must not make paid calls.");
    console.info("[e2e] Fixture archived; no model usage recorded.");
    return;
  }
  const id = crypto.randomUUID().slice(0, 8);
  const { worldId, companyId } = await seedHelixBiologics(sql, `Helix Biologics (e2e ${id})`);
  await seedScenarioLibrary(sql, companyId, readScenarioFiles(join(__dirname, "..", "evals", "scenarios")));
  const logins = await createDemoLogins(sql, worldId, `e2e-${id}.example`);
  const qa = logins.find((l) => l.role === "QA Director");
  const plantManager = logins.find((l) => l.role === "Plant Manager");
  const supplyChain = logins.find((l) => l.name === "Tomás Reyes");
  const regulatory = logins.find((l) => l.name === "Hannah Okafor");
  const executive = logins.find((l) => l.name === "Daniel Brooks");
  const strategy = logins.find((l) => l.name === "Sofia Lindqvist");
  if (!qa || !plantManager || !supplyChain || !regulatory || !executive || !strategy) throw new Error("Seed is missing a Phase 7 decision maker");

  const code = `E2E-${id.slice(0, 4).toUpperCase()}`;
  const [incident] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId, code, title: "Sterility failure on batch A-2235 (test)", incidentType: "quality", severity: "critical" })}
    returning id`;
  if (!incident) throw new Error("setup");
  const incidentId = incident.id;
  const pausedCode = `E2E-P${id.slice(0, 4).toUpperCase()}`;
  const closableCode = `E2E-C${id.slice(0, 4).toUpperCase()}`;
  const [paused] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId, code: pausedCode, title: "Lower priority quality investigation (test)", incidentType: "quality", severity: "watch", status: "paused" })}
    returning id`;
  const [closable] = await sql<{ id: string }[]>`
    insert into incidents ${sql({ worldId, companyId, code: closableCode, title: "Completed investigation (test)", incidentType: "quality", severity: "info" })}
    returning id`;
  if (!paused || !closable) throw new Error("Failed to create the paused and closable incidents");

  // Exhaust only fixture budgets so event handlers and scheduled sweeps cannot make paid calls
  // when Inngest is running. The labelled synthetic costs are not actual model charges.
  await sql`
    insert into agent_runs (world_id, company_id, incident_id, agent_id, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
    select ${worldId}, ${companyId}, i.id, a.id, 'e2e-budget-guard', 0, 0,
      ceil(coalesce((a.config ->> 'costBudgetUsd')::numeric, 0.5) * 10000) / 10000, 0, 'budget_exceeded'
    from incidents i cross join agent_configs a where i.world_id = ${worldId}`;
  await sql`
    insert into agent_runs (world_id, company_id, incident_id, agent_id, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
    select ${worldId}, ${companyId}, null, a.id, 'e2e-budget-guard', 0, 0,
      ceil(coalesce((a.config ->> 'costBudgetUsd')::numeric, 0.5) * ${NO_INCIDENT_DAILY_RUNS} * 10000) / 10000, 0, 'budget_exceeded'
    from agent_configs a`;
  await sql`insert into watcher_heartbeats (watcher_id, last_seen_at) values (${`readings:${worldId}`}, now())`;
  await sql`insert into incident_events ${sql({
    worldId, companyId, incidentId: paused.id, actorType: "system", actorId: "e2e-fixture", eventType: "paused",
    payload: sql.json({ reason: "Lower priority than a critical incident.", previousStatus: "open" }),
  })}`;
  await sql`insert into incident_events ${sql({
    worldId, companyId, incidentId: closable.id, actorType: "system", actorId: "e2e-fixture", eventType: "opened", payload: sql.json({ objects: [] }),
  })}`;
  await sql`insert into incident_events ${sql({
    worldId,
    companyId,
    incidentId: incident.id,
    actorType: "system",
    actorId: "workflow",
    eventType: "opened",
    payload: sql.json({ objects: [{ table: "batches", code: "A-2235", id: await resolveRef(sql, worldId, { table: "batches", code: "A-2235" }) }] }),
  })}`;

  const batchId = await resolveRef(sql, worldId, { table: "batches", code: "A-2235" });
  const answer = {
    kind: "proposal",
    summary: "Hold batch A-2235 while the sterility failure is investigated.",
    reasoning: "A-2235 shares gasket lot G-77 with the failed batch.",
    sources: [{ table: "batches", rowId: batchId, note: "Batch A-2235, in production on Line 3" }],
    confidence: "medium",
    alternatives: [],
    requiresApproval: true,
    approvalSeat: "qa_director",
    proposedAction: { type: "hold_batch", params: { batches: ["A-2235"], reason: "Shares gasket lot G-77" } },
  } satisfies Answer;
  await sql`insert into decision_records ${sql({
    worldId,
    companyId,
    incidentId: incident.id,
    agentId: "quarantine_officer",
    record: sql.json({ agentId: "quarantine_officer", incidentId: incident.id, worldId, answer, rejectedSources: [] }),
    requiresApproval: true,
  })}`;

  async function storeDecision(agentId: string, raw: Answer): Promise<string> {
    const answer = AgentAnswer.parse(raw);
    const [row] = await sql<{ id: string }[]>`insert into decision_records ${sql({
      worldId, companyId, incidentId, agentId,
      record: sql.json({ agentId, incidentId, worldId, answer, rejectedSources: [] } as unknown as Parameters<typeof sql.json>[0]),
      requiresApproval: answer.requiresApproval,
    })} returning id`;
    if (!row) throw new Error(`Failed to seed ${agentId}'s decision`);
    return row.id;
  }

  // A Supply Chain decision stays pending even after the existing QA approval test runs.
  const shipmentId = await resolveRef(sql, worldId, { table: "shipments", code: "SH-119" });
  await storeDecision("quarantine_officer", {
    ...answer,
    summary: "Hold shipment SH-119 pending the quality investigation.",
    reasoning: "SH-119 contains batch A-2230, which used gasket lot G-77.",
    sources: [{ table: "shipments", rowId: shipmentId, note: "SH-119 is planned and contains A-2230" }],
    approvalSeat: "supply_chain_lead",
    proposedAction: { type: "hold_shipment", params: { shipments: ["SH-119"], reason: "Pending investigation of gasket lot G-77" } },
  });

  const [hannah] = await sql<{ id: string }[]>`select id from people where world_id = ${worldId} and name = ${regulatory.name}`;
  if (!hannah) throw new Error("Hannah's person record is missing");
  await takeSeat(sql, { worldId, companyId, incidentId: incident.id, role: "regulatory_affairs", personId: hannah.id });
  const [rule] = await sql<{ id: string }[]>`select id from regulatory_rules where world_id = ${worldId} and code = 'NMA-QD-1'`;
  if (!rule) throw new Error("The fictional regulatory rule is missing");
  const regulatoryAnswer = {
    ...answer,
    sources: [{ table: "regulatory_rules", rowId: rule.id, note: "Fictional NMA-QD-1 initial quality defect report rule" }],
    approvalSeat: "regulatory_affairs" as const,
  };
  for (const [agentId, seededAnswer] of [
    ["regulator_b", {
      ...regulatoryAnswer,
      summary: "Confirm NMA-QD-1 for this quality investigation.",
      reasoning: "The fixture investigation covers potentially distributed product under the fictional rule.",
      proposedAction: { type: "confirm_reporting_obligation", params: { ruleCode: "NMA-QD-1", reason: "Potential quality defect in distributed product (e2e fixture)." } },
    }],
    ["comms_agent", {
      ...regulatoryAnswer,
      summary: "Submit the initial quality defect report.",
      reasoning: "Regulatory Affairs confirmed NMA-QD-1; the initial report is ready for approval.",
      proposedAction: { type: "submit_notification", params: { to: ["NMA Quality Defects Unit"], subject: "Initial quality defect report", message: "Fixture report: the quality investigation is open and affected product is under assessment.", ruleCode: "NMA-QD-1" } },
    }],
  ] as const) {
    const decisionRecordId = await storeDecision(agentId, seededAnswer);
    await recordApproval(sql, { worldId, decisionRecordId, seat: "regulatory_affairs", personId: hannah.id, outcome: "approved" });
    const execution = await executeApproved(sql, worldId, decisionRecordId);
    if (execution.status !== "executed") throw new Error(`Could not execute ${agentId}'s fixture decision: ${JSON.stringify(execution.result)}`);
    // Do not emit follow-ups: the fixture queues the approved message without delivering it.
  }

  const change = { kind: "test_capacity", addSlots: 2 } as const;
  const proposal = await createProposal(sql, worldId, companyId, {
    title: "Add two sterility test slots (test)", summary: "Compare the existing lab with two additional sterility test slots.", change,
  }, "capacity_planner", null);
  if (!proposal.ok) throw new Error(proposal.problems.join(" "));
  const optimizerUp = await optimizerIsUp();
  if (optimizerUp) {
    await simulateProposal(sql, worldId, companyId, proposal.id, change);
  } else {
    console.warn("[e2e] Optimizer unavailable; using typed fixture stress results.");
    const [capacity] = await sql<{ testSlots: number; qaReviewsPerDay: number; fillLines: number }[]>`
      select (select capacity from capacity_resources where world_id = ${worldId} and kind = 'sterility_test' limit 1) as test_slots,
        (select capacity from capacity_resources where world_id = ${worldId} and kind = 'qa_release' limit 1) as qa_reviews_per_day,
        (select count(*)::int from production_lines where world_id = ${worldId} and status = 'running') as fill_lines`;
    if (!capacity) throw new Error("Missing fixture capacity");
    const dueAt = new Date(Date.now() + 20 * 24 * 3_600_000).toISOString();
    const baseline: StressResult = {
      orders: [{ name: "Rush", quantity: 300, dueAt, arrivesAt: dueAt, lateHours: 0, onTime: true }],
      onTime: 1, lateHours: 0, unmet: 0,
      outage: { haltedLine: "Line 3", linesLeft: Math.max(0, capacity.fillLines - 1), surgeArrivesAt: dueAt, surgeLateHours: 0 },
      singleSourceMaterials: ["Vial stoppers"], capacity,
    };
    const withChange: StressResult = { ...baseline, capacity: { ...capacity, testSlots: capacity.testSlots + change.addSlots } };
    await sql`insert into expansion_simulations ${sql({
      worldId, companyId, proposalId: proposal.id,
      baseline: sql.json(baseline as unknown as Parameters<typeof sql.json>[0]),
      withChange: sql.json(withChange as unknown as Parameters<typeof sql.json>[0]),
    })}`;
  }
  const bigProposal = await createProposal(sql, worldId, companyId, {
    title: "Add two QA reviews per day (test)", summary: "Increase QA release capacity with Executive approval of the spend.", change: { kind: "qa_capacity", addPerDay: 2 },
  }, "capacity_planner", null);
  if (!bigProposal.ok) throw new Error(bigProposal.problems.join(" "));

  const lesson = "Never propose holding a delivered shipment; flag it for a recall assessment instead.";
  const learningDecisionId = await storeDecision("learning_loop", {
    kind: "proposal", summary: "Teach the Quarantine Officer how to handle delivered shipments.",
    reasoning: "Delivered shipments require recall assessment rather than a shipment hold.",
    sources: [{ table: "shipments", rowId: await resolveRef(sql, worldId, { table: "shipments", code: "SH-115" }), note: "SH-115 is already delivered" }],
    confidence: "high", alternatives: [], requiresApproval: false,
    proposedAction: { type: "propose_lesson", params: { agentId: "quarantine_officer", lesson, rationale: "Shipment holds cannot contain product already delivered.", evidence: [] } },
  });
  const proposedLesson = await proposeLesson(sql, worldId, companyId, learningDecisionId, {
    agentId: "quarantine_officer", lesson, rationale: "Shipment holds cannot contain product already delivered.", evidence: [learningDecisionId],
  });
  if (!proposedLesson.ok) throw new Error(proposedLesson.problem);

  console.log(JSON.stringify({
    email: qa.email, plantManagerEmail: plantManager.email,
    supplyChainEmail: supplyChain.email, regulatoryEmail: regulatory.email, executiveEmail: executive.email, strategyEmail: strategy.email,
    password: DEMO_PASSWORD, code, pausedCode, closableCode, proposalCode: proposal.code, bigProposalCode: bigProposal.code,
    worldId, simulationSource: optimizerUp ? "optimizer" : "fixture",
  }));
}

main().then(closeSql, async (err) => {
  console.error(err);
  await closeSql();
  process.exit(1);
});
