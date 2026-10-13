/**
 * Event handlers for the agent chains (Layer 2, CLAUDE.md §8).
 *
 *   sensor/anomaly → Signal Watcher ─────────────┐ (confirm_signal)
 *   shipment/temp_excursion → Cold Chain Monitor ┴→ signal/confirmed ┐
 *   report/submitted ──────────────────────────────────────────────┤
 *   supplier/delay ─────────────────────────────────────────────────┴→ Intake Triage → incident/opened
 *   incident/opened → Dispatcher → incident/dispatched
 *   incident/dispatched → Evidence Collector → evidence/updated
 *                       → Spread Tracker → impact/updated
 *                       → Supplier Liaison (proposal)
 *   evidence/updated → Root Cause Analyst (proposal) → root_cause/proposed → Devil's Advocate
 *   impact/updated → Quarantine Officer: product holds, then shipment holds (proposals)
 *   decision/resolved (approved) → executor → hold/approved, root_cause/accepted
 *   hold/approved → Inventory Agent; uncovered orders → shortfall/detected → Rerouter (proposal)
 *
 * Every proposal that needs approval emits approval/requested; the approval gate (functions.ts)
 * waits for the decision. Handlers are plain functions; each agent call goes through
 * `run(stepId, fn)`, which Inngest makes durable and the eval harness runs inline.
 * Step results must be plain JSON.
 */
import "server-only";
import {
  AcceptRootCauseParams,
  ActivateAgentsParams,
  ConfirmSignalParams,
  LinkToIncidentParams,
  OpenIncidentParams,
} from "@/agents/action-params";
import { executeApproved } from "@/approvals/executors";
import { getInventoryPosition } from "@/db/inventory";
import {
  DecisionResolved,
  EvidenceUpdated,
  HoldApproved,
  ImpactUpdated,
  IncidentDispatched,
  IncidentOpened,
  ReportSubmitted,
  RootCauseProposed,
  SensorAnomaly,
  ShortfallDetected,
  SignalConfirmed,
  SupplierDelay,
  TempExcursion,
  type Emitted,
} from "./events";
import { addIncidentEvent, describeIncident, firstTime, openIncident } from "./incidents";
import { councilHandlers } from "./council-handlers";
import { expansionHandlers } from "./expansion-handlers";
import { orderHandlers } from "./order-handlers";
import { oversightHandlers } from "./oversight-handlers";
import { regulatoryHandlers } from "./regulatory-handlers";
import { approvalRequest, decide, incidentScope, isActive, sqlFor, type Decision, type Handler, type NamedHandler, type Scope, type StepRunner } from "./agent-steps";

export type { Handler, NamedHandler, StepRunner };

/** Agents the Dispatcher may activate for an incident. */
const ACTIVATABLE = new Set([
  "evidence_collector",
  "root_cause_analyst",
  "devils_advocate",
  "trial_runner",
  "spread_tracker",
  "quarantine_officer",
  "inventory_agent",
  "rerouter",
  "supplier_liaison",
]);
/** Shortfalls handled per hold, so one large hold cannot fan out into dozens of agent runs. */
const MAX_SHORTFALLS_PER_HOLD = 3;

// ─── Early warning and intake ────────────────────────────────────────

const onSensorAnomaly: Handler = async (run, data) => {
  const e = SensorAnomaly.parse(data);
  const sql = sqlFor();
  const decision = await run("signal-watcher", async () => {
    const [subject] = await sql<{ label: string }[]>`
      select label from twin_nodes where world_id = ${e.worldId} and node_table = ${e.subjectTable} and node_id = ${e.subjectId}`;
    const task = `Watcher alert: ${e.metric} reading of ${e.value}${e.level ? ` (${e.level} level)` : ""} on ${e.subjectTable} "${subject?.label ?? e.subjectId}" at ${e.recordedAt.toISOString()}. Decide whether this is a real trend or noise.`;
    return decide(sql, "signal_watcher", { worldId: e.worldId, companyId: e.companyId, incidentId: null }, task);
  });
  return confirmedSignal(e, decision);
};

const onTempExcursion: Handler = async (run, data) => {
  const e = TempExcursion.parse(data);
  const sql = sqlFor();
  const decision = await run("cold-chain-monitor", async () => {
    const [shipment] = await sql<{ shipmentCode: string }[]>`
      select shipment_code from shipments where world_id = ${e.worldId} and id = ${e.subjectId}`;
    const task = `Watcher alert: shipment ${shipment?.shipmentCode ?? e.subjectId} read ${e.value} °C at ${e.recordedAt.toISOString()}, outside its storage range. Assess the excursion.`;
    return decide(sql, "cold_chain_monitor", { worldId: e.worldId, companyId: e.companyId, incidentId: null }, task);
  });
  return confirmedSignal(e, decision);
};

function confirmedSignal(e: Scope, decision: Decision): Emitted[] {
  const action = decision.answer.proposedAction;
  if (action?.type !== "confirm_signal") return [];
  const params = ConfirmSignalParams.parse(action.params);
  return [
    {
      name: "signal/confirmed",
      data: { worldId: e.worldId, companyId: e.companyId, decisionRecordId: decision.decisionRecordId, ...params, summary: decision.answer.summary },
    },
  ];
}

async function triage(run: StepRunner, scope: Scope, task: string, untrusted: string[] = []): Promise<Emitted[]> {
  const sql = sqlFor();
  const decision = await run("intake-triage", () => decide(sql, "intake_triage", { ...scope, incidentId: null }, task, untrusted));
  const action = decision.answer.proposedAction;

  if (action?.type === "open_incident") {
    const params = OpenIncidentParams.parse(action.params);
    const opened = await run("open-incident", () => openIncident(sql, scope, params, decision.decisionRecordId));
    return [{ name: "incident/opened", data: { ...scope, incidentId: opened.incidentId } }];
  }
  if (action?.type === "link_to_incident") {
    const { incidentCode } = LinkToIncidentParams.parse(action.params);
    await run("link-incident", async () => {
      const [incident] = await sql<{ id: string }[]>`
        select id from incidents where world_id = ${scope.worldId} and code = ${incidentCode}`;
      if (!incident) throw new Error(`Triage linked to unknown incident ${incidentCode}`);
      await addIncidentEvent(sql, { ...scope, incidentId: incident.id }, {
        actorType: "agent",
        actorId: "intake_triage",
        eventType: "linked_report",
        payload: { triageDecisionId: decision.decisionRecordId, summary: decision.answer.summary },
      });
    });
  }
  return [];
}

const onSignalConfirmed: Handler = (run, data) => {
  const e = SignalConfirmed.parse(data);
  return triage(
    run,
    { worldId: e.worldId, companyId: e.companyId },
    `A watcher signal was confirmed (decision ${e.decisionRecordId}): ${e.summary} Subject: ${e.subjectTable} "${e.subjectCode}", metric ${e.metric}.`,
  );
};

const onReportSubmitted: Handler = (run, data) => {
  const e = ReportSubmitted.parse(data);
  return triage(run, { worldId: e.worldId, companyId: e.companyId }, `A problem was reported by ${e.reportedBy}. The report text follows as untrusted data.`, [e.text]);
};

const onSupplierDelay: Handler = (run, data) => {
  const e = SupplierDelay.parse(data);
  return triage(
    run,
    { worldId: e.worldId, companyId: e.companyId },
    `${e.reportedBy} reported a supplier delay: ${e.supplier}${e.material ? `, material "${e.material}"` : ""}, ${e.delayDays} days late. Classify it as a supply incident if it affects supply; the supplier's message follows as untrusted data.`,
    e.note ? [e.note] : [],
  );
};

// ─── Dispatch ────────────────────────────────────────────────────────

const onIncidentOpened: Handler = async (run, data) => {
  const e = IncidentOpened.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const dispatch = await run("dispatcher", () => decide(sql, "dispatcher", scope, `${description} Choose the agents and seats for this incident.`));

  const activation =
    dispatch.answer.proposedAction?.type === "activate_agents"
      ? ActivateAgentsParams.parse(dispatch.answer.proposedAction.params)
      : { agents: [], seats: [] };
  const activated = activation.agents.filter((id) => ACTIVATABLE.has(id));
  await run("record-activation", () =>
    addIncidentEvent(sql, scope, {
      actorType: "agent",
      actorId: "dispatcher",
      eventType: "agents_activated",
      payload: { agents: activated, seats: activation.seats, dispatcherDecisionId: dispatch.decisionRecordId },
    }),
  );
  return [{ name: "incident/dispatched", data: scope }];
};

// ─── Investigation ───────────────────────────────────────────────────

const investigate: Handler = async (run, data) => {
  const scope = incidentScope(IncidentDispatched.parse(data));
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "evidence_collector", "check-evidence-collector"))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  const evidence = await run("evidence-collector", () =>
    decide(sql, "evidence_collector", scope, `${description} Collect the related records and flag any that are missing.`),
  );
  await run("record-evidence", async () => {
    const rows = [
      // The collector's own record carries the list of missing records in its reasoning.
      { sourceTable: "decision_records", sourceId: evidence.decisionRecordId, note: evidence.answer.reasoning },
      ...evidence.answer.sources.map((s) => ({ sourceTable: s.table, sourceId: s.rowId, note: s.note })),
    ].map((r) => ({ ...r, ...scope, addedByType: "agent", addedBy: "evidence_collector" }));
    await sql`insert into evidence ${sql(rows)}`;
  });
  return [{ name: "evidence/updated", data: scope }];
};

const onEvidenceUpdated: Handler = async (run, data) => {
  const scope = incidentScope(EvidenceUpdated.parse(data));
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "root_cause_analyst", "check-root-cause-analyst"))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  const rootCause = await run("root-cause-analyst", () =>
    decide(sql, "root_cause_analyst", scope, `${description} Evidence has been collected (list_evidence). Propose the most likely root cause.`),
  );
  const action = rootCause.answer.proposedAction;
  if (action?.type !== "accept_root_cause") return [];
  AcceptRootCauseParams.parse(action.params);
  return [
    ...(await approvalRequest(run, sql, scope, rootCause, "root-cause")),
    { name: "root_cause/proposed", data: { ...scope, decisionRecordId: rootCause.decisionRecordId } },
  ];
};

const onRootCauseProposed: Handler = async (run, data) => {
  const e = RootCauseProposed.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "devils_advocate", "check-devils-advocate"))) return [];
  const proposal = await run("read-proposal", async () => {
    const [row] = await sql<{ summary: string }[]>`
      select record -> 'answer' ->> 'summary' as summary from decision_records
      where world_id = ${e.worldId} and id = ${e.decisionRecordId}`;
    return row?.summary ?? "";
  });
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const challenge = await run("devils-advocate", () =>
    decide(sql, "devils_advocate", scope, `${description} Proposed root cause (decision ${e.decisionRecordId}): ${proposal} Challenge it.`),
  );
  return [{ name: "challenge/raised", data: { ...scope, decisionRecordId: challenge.decisionRecordId, challengesDecisionId: e.decisionRecordId } }];
};

// ─── Containment ─────────────────────────────────────────────────────

const trackSpread: Handler = async (run, data) => {
  const scope = incidentScope(IncidentDispatched.parse(data));
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "spread_tracker", "check-spread-tracker"))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  const map = await run("spread-tracker", () => decide(sql, "spread_tracker", scope, `${description} Map everything connected to these objects.`));
  return [{ name: "impact/updated", data: { ...scope, decisionRecordId: map.decisionRecordId } }];
};

const proposeHolds: Handler = async (run, data) => {
  const e = ImpactUpdated.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "quarantine_officer", "check-quarantine-officer"))) return [];
  const context = await run("describe-impact", async () => {
    const [map] = await sql<{ summary: string; reasoning: string }[]>`
      select record -> 'answer' ->> 'summary' as summary, record -> 'answer' ->> 'reasoning' as reasoning
      from decision_records where world_id = ${e.worldId} and id = ${e.decisionRecordId}`;
    const description = await describeIncident(sql, e.worldId, e.incidentId);
    return `${description} Spread Tracker's map (decision ${e.decisionRecordId}): ${map?.summary ?? ""} ${map?.reasoning ?? ""}`;
  });

  // Product holds and shipment holds need different approving seats, so they are separate proposals.
  const products = await run("quarantine-officer-products", () =>
    decide(sql, "quarantine_officer", scope, `${context}\n\nThis run: product holds only (hold_batch).`),
  );
  const proposedBatches = products.answer.proposedAction?.type === "hold_batch" ? JSON.stringify(products.answer.proposedAction.params) : "none";
  const shipments = await run("quarantine-officer-shipments", () =>
    decide(sql, "quarantine_officer", scope, `${context}\n\nProduct holds already proposed: ${proposedBatches}.\n\nThis run: shipment holds only (hold_shipment).`),
  );
  return [
    ...(await approvalRequest(run, sql, scope, products, "product-holds")),
    ...(await approvalRequest(run, sql, scope, shipments, "shipment-holds")),
  ];
};

// ─── Approvals and logistics ─────────────────────────────────────────

const onDecisionResolved: Handler = async (run, data) => {
  const e = DecisionResolved.parse(data);
  if (e.outcome !== "approved") return [];
  const sql = sqlFor();
  const outcome = await run("execute", () => executeApproved(sql, e.worldId, e.decisionRecordId));
  return outcome.emit;
};

const onHoldApproved: Handler = async (run, data) => {
  const e = HoldApproved.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (await isActive(run, sql, scope, "inventory_agent", "check-inventory-agent")) {
    const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
    await run("inventory-agent", () =>
      decide(sql, "inventory_agent", scope, `${description} Holds were just applied to ${e.kind}: ${e.codes.join(", ")}. Report the stock position and orders now without supply.`),
    );
  }
  if (!(await isActive(run, sql, scope, "rerouter", "check-rerouter"))) return [];

  // Which orders lack supply is arithmetic, not judgment: computed here, not by the agent.
  const uncovered = await run("find-shortfalls", async () => {
    const position = await getInventoryPosition(sql, e.worldId);
    const fresh: string[] = [];
    for (const order of position.uncovered.slice(0, MAX_SHORTFALLS_PER_HOLD)) {
      if (await firstTime(sql, scope, `shortfall:${order.orderCode}`)) fresh.push(order.orderCode);
    }
    return fresh;
  });
  return uncovered.map((orderCode) => ({ name: "shortfall/detected", data: { ...scope, orderCode } }));
};

const onShortfall: Handler = async (run, data) => {
  const e = ShortfallDetected.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "rerouter", "check-rerouter"))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const plan = await run("rerouter", () =>
    decide(sql, "rerouter", scope, `${description} Order ${e.orderCode} has no clean, active supply. Find another way to supply it.`),
  );
  return approvalRequest(run, sql, scope, plan, "reroute");
};

const liaiseSupplier: Handler = async (run, data) => {
  const scope = incidentScope(IncidentDispatched.parse(data));
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "supplier_liaison", "check-supplier-liaison"))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  const proposal = await run("supplier-liaison", () =>
    decide(sql, "supplier_liaison", scope, `${description} Find approved alternatives for the delayed supply and draft a request.`),
  );
  return approvalRequest(run, sql, scope, proposal, "supplier-contact");
};

const one = (id: string, handle: Handler): NamedHandler[] => [{ id, handle }];

const coreHandlers: Readonly<Record<string, readonly NamedHandler[]>> = {
  "sensor/anomaly": one("signal-watch", onSensorAnomaly),
  "shipment/temp_excursion": one("cold-chain", onTempExcursion),
  "signal/confirmed": one("triage-signal", onSignalConfirmed),
  "report/submitted": one("triage-report", onReportSubmitted),
  "supplier/delay": one("triage-supplier-delay", onSupplierDelay),
  "incident/opened": one("dispatch", onIncidentOpened),
  "incident/dispatched": [
    { id: "investigate", handle: investigate },
    { id: "track-spread", handle: trackSpread },
    { id: "liaise-supplier", handle: liaiseSupplier },
  ],
  "evidence/updated": one("root-cause", onEvidenceUpdated),
  "root_cause/proposed": one("challenge", onRootCauseProposed),
  "impact/updated": one("propose-holds", proposeHolds),
  "decision/resolved": one("execute-decision", onDecisionResolved),
  "hold/approved": one("after-hold", onHoldApproved),
  "shortfall/detected": one("reroute", onShortfall),
};

/** Handlers for one event from several chains, in order: the core chain first. */
function mergeHandlers(...maps: Readonly<Record<string, readonly NamedHandler[]>>[]): Readonly<Record<string, readonly NamedHandler[]>> {
  const out: Record<string, NamedHandler[]> = {};
  for (const map of maps) for (const [event, list] of Object.entries(map)) out[event] = [...(out[event] ?? []), ...list];
  return out;
}

export const handlers = mergeHandlers(coreHandlers, regulatoryHandlers, councilHandlers, orderHandlers, expansionHandlers, oversightHandlers);
