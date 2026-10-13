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

/** Auditor: the end-of-drill review. Not an action; the structured part of the finding. */
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
