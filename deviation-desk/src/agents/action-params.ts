/**
 * Parameter shapes for the proposedAction types the first agent chain acts on.
 * Workflows parse params with these before using them; the agent prompts describe the same shapes.
 */
import { z } from "zod";

const ObjectRef = z.object({ table: z.string(), code: z.string() });

/** Signal Watcher: the anomaly is a real trend. Not consequential; no approval needed. */
export const ConfirmSignalParams = z.object({
  subjectTable: z.string(),
  subjectCode: z.string(),
  metric: z.string(),
});

export const IncidentType = z.enum(["quality", "equipment", "supply", "cold_chain", "safety", "clinical"]);
export const Severity = z.enum(["info", "watch", "warning", "critical"]);

/** Intake Triage: open a new incident. Not consequential; the workflow opens it and logs the triage record. */
export const OpenIncidentParams = z.object({
  title: z.string().min(1).max(200),
  incidentType: IncidentType,
  severity: Severity,
  objects: z.array(ObjectRef).max(20),
});

/** Intake Triage: the problem belongs to an incident that is already open. */
export const LinkToIncidentParams = z.object({ incidentCode: z.string() });

/** Dispatcher: which agents to wake and which seats to notify. */
export const ActivateAgentsParams = z.object({
  agents: z.array(z.string()),
  seats: z.array(z.string()).default([]),
});

/** Root Cause Analyst: accept this root cause. Consequential; the QA Director approves. */
export const AcceptRootCauseParams = z.object({
  cause: z.string(),
  causeObject: ObjectRef.optional(),
});

/** Quarantine Officer: hold these batches and all their stock. QA Director or Plant Manager approves. */
export const HoldBatchParams = z.object({
  batches: z.array(z.string()).min(1),
  reason: z.string(),
});

/** Quarantine Officer: hold these shipments. Supply Chain Lead approves. */
export const HoldShipmentParams = z.object({
  shipments: z.array(z.string()).min(1),
  reason: z.string(),
});

/** Rerouter: supply an order from these locations, as the optimizer planned. Supply Chain Lead approves. */
export const RerouteSupplyParams = z.object({
  orderCode: z.string(),
  allocations: z.array(z.object({ location: z.string(), quantity: z.number().int().positive() })).min(1),
  totalCost: z.number().optional(),
  arrivesWithinHours: z.number().optional(),
});

/** Scenario Builder: run this scenario. The facilitator approves the preview before it can run. */
export const RunScenarioParams = z.object({
  scenario: z.unknown(),
  hiddenTruth: z.unknown(),
});

/** Auditor: the review after a drill ends (record_drill_review) or a live incident closes (record_incident_review). Not an action. */
export const DrillReviewParams = z.object({
  teamGrade: z.string(),
  seatGrades: z.array(z.object({ seat: z.string(), grade: z.string(), note: z.string() })),
  rootCauseVerdict: z.string(),
  topFixes: z.array(z.string()).max(5),
});

/** Supplier Liaison: send this drafted request to an approved supplier. Supply Chain Lead approves. */
export const ContactSupplierParams = z.object({
  supplier: z.string(),
  material: z.string(),
  message: z.string().min(1).max(4000),
});

/**
 * Comms Agent: send this drafted message. Who approves depends on the audience (approvals.ts):
 * notify_customer (Supply Chain Lead), notify_trial_site (Clinical Ops), notify_staff (Plant
 * Manager or QA Director), submit_notification (Regulatory Affairs; names the rule it fulfils).
 * Recipients are contact names or organizations from get_contacts.
 */
export const MessageParams = z.object({
  to: z.array(z.string().min(1)).min(1).max(10),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(6000),
  ruleCode: z.string().optional(),
});

/** Regulator B: Regulatory Affairs confirms that this rule applies. The system computes the deadline. */
export const ConfirmObligationParams = z.object({
  ruleCode: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

/** Event Council member: a vote on a Decision Board conflict. Advice for the Executive, not an action. */
export const CouncilVoteParams = z.object({
  // Models sometimes write the id as a number; it is the same id.
  conflictId: z.coerce.string().regex(/^\d+$/),
  favors: z.enum(["raising_seat", "other_seat", "neither"]),
  position: z.string().min(1).max(500),
});

/** Coordinator: pause a lower-priority incident's agent work so a more urgent one gets capacity. Executive approves. */
export const PauseIncidentParams = z.object({
  incidentCode: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

/** Order Desk: its check of one order. Not an action; links the finding to the order. */
export const OrderCheckParams = z.object({ orderCode: z.string(), affectedByIncidents: z.array(z.string()).default([]) });

/** Scheduler: the plan it explained for one order. Not an action; the optimizer's figures. */
export const ScheduleOptionsParams = z.object({ orderCode: z.string(), earliestArrival: z.string().nullable().optional(), onTime: z.boolean().optional() });

/** Trial Runner: a quick confirm/rule-out test. QA Director approves; approval creates the test task. */
export const RunTestParams = z.object({
  test: z.string().min(1).max(300),
  targets: z.array(z.string()).min(1).max(10),
  ifCauseConfirmed: z.string().min(1).max(500),
  ifRuledOut: z.string().min(1).max(500),
  durationHours: z.number().positive().max(24 * 21),
});

/** Expansion planners: draft a proposal. Not consequential; code validates and prices it, people decide. */
export const ProposeExpansionParams = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  change: z.record(z.string(), z.unknown()),
});

/** Readiness Checker: whether a proposal is ready to decide, and what it still needs. */
export const ReadinessCheckParams = z.object({
  proposalCode: z.string(),
  verdict: z.enum(["ready", "not_yet"]),
  gaps: z.array(z.string()).max(10).default([]),
});

/** Expansion Lead: open proposals in recommended order. */
export const RankProposalsParams = z.object({ ranking: z.array(z.string()).max(20) });

/** Learning Loop: a lesson for one agent. Not an action; code records it and people decide. */
export const ProposeLessonParams = z.object({
  agentId: z.string().min(1),
  lesson: z.string().min(1).max(500),
  rationale: z.string().min(1).max(2000),
  evidence: z.array(z.string()).max(20).default([]),
});
