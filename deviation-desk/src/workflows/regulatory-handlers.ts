/**
 * Regulatory and communications chains (Phase 7). These agents are not chosen by the Dispatcher:
 * they follow the incident's severity and the decisions people make.
 *
 *   approval/requested (critical) → Regulator A: advisory on the proposal, shown on its card
 *   hold/approved, root_cause/accepted, incident/escalated → Regulator B: possible obligation
 *   obligation/confirmed → Regulator B (anything further?) and Comms Agent (draft the submission)
 *   hold/approved (shipments to customers or trial sites) → Comms Agent: notice per destination
 *   incident/escalated (critical) → Comms Agent: executive brief
 *
 * Proposals go through the approval gate like any other; approved messages land in the outbox.
 */
import "server-only";
import { getSql, type Sql } from "@/db/client";
import { hoursLeft, worldNow } from "@/regulatory/deadlines";
import { approvalRequest, decide, incidentScope, sqlFor, type Handler, type IncidentScope, type NamedHandler, type StepRunner } from "./agent-steps";
import { ApprovalRequested, HoldApproved, IncidentEscalated, ObligationConfirmed, RootCauseAccepted, type Emitted } from "./events";
import { addIncidentEvent, describeIncident, firstTime, incidentSeverity } from "./incidents";

/** Actions an inspector would scrutinize. Messages and drill-only actions are not reviewed. */
const REVIEWED_ACTIONS = new Set([
  "accept_root_cause",
  "hold_batch",
  "hold_shipment",
  "quarantine_location",
  "halt_line",
  "restart_line",
  "reroute_supply",
  "recall",
  "resolve_board_conflict",
]);
/** Regulator B runs at most this many times per incident, so obligations cannot loop. */
const MAX_OBLIGATION_RUNS = 4;
/** Comms drafts regulatory submissions due within this many hours; later ones wait for the investigation. */
const DRAFT_WITHIN_HOURS = 7 * 24;
/** Customer and trial-site notices drafted per shipment hold. */
const MAX_NOTICES_PER_HOLD = 3;

const once = (run: StepRunner, sql: Sql, scope: IncidentScope, key: string) => run(`once-${key}`, () => firstTime(sql, scope, key));

// ─── Regulator A ─────────────────────────────────────────────────────

const reviewProposal: Handler = async (run, data) => {
  const e = ApprovalRequested.parse(data);
  if (e.severity !== "critical" || !REVIEWED_ACTIONS.has(e.actionType)) return [];
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (!(await once(run, sql, scope, `regulator_a:${e.decisionRecordId}`))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const advisory = await run("regulator-a", () =>
    decide(sql, "regulator_a", scope, `${description} Review proposal ${e.decisionRecordId} (${e.actionType}), waiting for the ${e.seat} seat.`),
  );
  await run("record-advisory", () =>
    addIncidentEvent(sql, scope, {
      actorType: "agent",
      actorId: "regulator_a",
      eventType: "advisory_added",
      payload: { reviewsDecisionId: e.decisionRecordId, advisoryDecisionId: advisory.decisionRecordId, summary: advisory.answer.summary },
    }),
  );
  return [];
};

// ─── Regulator B ─────────────────────────────────────────────────────

async function flagObligations(run: StepRunner, scope: IncidentScope, why: string, onceKey: string): Promise<Emitted[]> {
  const sql = sqlFor();
  const severity = await run("severity", () => incidentSeverity(sql, scope.worldId, scope.incidentId));
  if (severity !== "warning" && severity !== "critical") return [];
  if (!(await once(run, sql, scope, `regulator_b:${onceKey}`))) return [];
  const runs = await run("count-regulator-b", async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from agent_runs where world_id = ${scope.worldId} and incident_id = ${scope.incidentId} and agent_id = 'regulator_b'`;
    return row?.n ?? 0;
  });
  if (runs >= MAX_OBLIGATION_RUNS) return [];
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  const flag = await run("regulator-b", () => decide(sql, "regulator_b", scope, `${description} ${why} Check for possible reporting obligations.`));
  if (flag.answer.proposedAction?.type !== "confirm_reporting_obligation") return [];
  return approvalRequest(run, sql, scope, flag, "obligation");
}

const obligationsAfterHold: Handler = async (run, data) => {
  const e = HoldApproved.parse(data);
  return flagObligations(run, incidentScope(e), `Holds were approved on ${e.kind}: ${e.codes.join(", ")}.`, "hold");
};

const obligationsAfterRootCause: Handler = async (run, data) => {
  const e = RootCauseAccepted.parse(data);
  return flagObligations(run, incidentScope(e), `The QA Director accepted the root cause (decision ${e.decisionRecordId}).`, "root-cause");
};

const obligationsAfterEscalation: Handler = async (run, data) => {
  const e = IncidentEscalated.parse(data);
  return flagObligations(run, incidentScope(e), "A decision on this incident was escalated for taking too long.", "escalation");
};

const furtherObligations: Handler = async (run, data) => {
  const e = ObligationConfirmed.parse(data);
  return flagObligations(run, incidentScope(e), `Regulatory Affairs confirmed ${e.ruleCode}. Check whether any other rule also applies.`, `after:${e.ruleCode}`);
};

// ─── Comms Agent ─────────────────────────────────────────────────────

async function draft(run: StepRunner, scope: IncidentScope, stepId: string, task: string): Promise<Emitted[]> {
  const sql = sqlFor();
  // Step ids stay unique when one handler drafts several messages.
  const description = await run(`${stepId}-describe`, () => describeIncident(sql, scope.worldId, scope.incidentId));
  const message = await run(stepId, () => decide(sql, "comms_agent", scope, `${description} ${task}`));
  return approvalRequest(run, sql, scope, message, stepId);
}

const draftSubmission: Handler = async (run, data) => {
  const e = ObligationConfirmed.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  // A report due weeks out (a follow-up) needs the investigation's results; it stays a task for
  // Regulatory Affairs instead of being drafted now from what little is known.
  const hours = await run("hours-to-deadline", async () => {
    const [o] = await sql<{ dueAt: Date }[]>`select due_at from regulatory_obligations where world_id = ${e.worldId} and id = ${e.obligationId}`;
    return o ? hoursLeft(o.dueAt, await worldNow(sql, e.worldId)) : 0;
  });
  if (hours > DRAFT_WITHIN_HOURS) return [];
  if (!(await once(run, sql, scope, `comms:submission:${e.ruleCode}`))) return [];
  return draft(
    run,
    scope,
    "comms-submission",
    `Regulatory Affairs confirmed reporting obligation ${e.ruleCode} (list_obligations shows its deadline). Draft the submission to the regulator for Regulatory Affairs to approve (submit_notification, ruleCode "${e.ruleCode}").`,
  );
};

/** Customers and trial sites whose shipments were just held: computed here, one notice each. */
async function heldDestinations(sql: Sql, worldId: string, shipmentCodes: string[]) {
  if (shipmentCodes.length === 0) return [];
  return sql<{ destination: string; kind: "customer" | "trial_site"; shipments: string[] }[]>`
    select l.name as destination, l.kind, array_agg(s.shipment_code order by s.shipment_code) as shipments
    from shipments s join locations l on l.world_id = s.world_id and l.id = s.destination_id
    where s.world_id = ${worldId} and s.shipment_code in ${sql(shipmentCodes)} and l.kind in ('customer', 'trial_site')
    group by l.name, l.kind
    order by l.name`;
}

const noticesAfterShipmentHold: Handler = async (run, data) => {
  const e = HoldApproved.parse(data);
  if (e.kind !== "shipments") return [];
  const scope = incidentScope(e);
  const sql = sqlFor();
  const destinations = await run("held-destinations", () => heldDestinations(getSql(), e.worldId, e.codes));
  const emitted: Emitted[] = [];
  for (const [i, d] of destinations.slice(0, MAX_NOTICES_PER_HOLD).entries()) {
    if (!(await once(run, sql, scope, `comms:notice:${d.destination}`))) continue;
    const audience = d.kind === "trial_site" ? "trial site" : "customer";
    emitted.push(
      ...(await draft(
        run,
        scope,
        `comms-notice-${i}`,
        `Shipments ${d.shipments.join(", ")} to ${audience} "${d.destination}" were put on hold. Draft a notice to that ${audience}: their delivery is held while the incident is investigated; do not promise a new date.`,
      )),
    );
  }
  return emitted;
};

const executiveBrief: Handler = async (run, data) => {
  const e = IncidentEscalated.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  const severity = await run("severity", () => incidentSeverity(sql, e.worldId, e.incidentId));
  if (severity !== "critical") return [];
  if (!(await once(run, sql, scope, "comms:executive-brief"))) return [];
  return draft(
    run,
    scope,
    "comms-executive-brief",
    `A decision waiting for the ${e.owner} seat was escalated (${e.reason}). Draft a short brief for the executives (internal staff contacts with executive roles): status, decisions waiting, and risks (notify_staff).`,
  );
};

export const regulatoryHandlers: Readonly<Record<string, readonly NamedHandler[]>> = {
  "approval/requested": [{ id: "regulator-a-review", handle: reviewProposal }],
  "hold/approved": [
    { id: "regulator-b-after-hold", handle: obligationsAfterHold },
    { id: "comms-hold-notices", handle: noticesAfterShipmentHold },
  ],
  "root_cause/accepted": [{ id: "regulator-b-after-root-cause", handle: obligationsAfterRootCause }],
  "incident/escalated": [
    { id: "regulator-b-after-escalation", handle: obligationsAfterEscalation },
    { id: "comms-executive-brief", handle: executiveBrief },
  ],
  "obligation/confirmed": [
    { id: "regulator-b-further", handle: furtherObligations },
    { id: "comms-submission", handle: draftSubmission },
  ],
};
