/**
 * Payloads of the events the agent chains use (names: docs/DOMAIN.md §Event names).
 * Handlers parse event data with these; nothing trusts an unchecked payload.
 */
import { z } from "zod";
import { SeatRole } from "@/agents/contract";

const WorldScoped = z.object({ worldId: z.uuid(), companyId: z.uuid() });
const IncidentScoped = WorldScoped.extend({ incidentId: z.uuid() });

// ─── Early warning and intake ───

export const SensorAnomaly = WorldScoped.extend({
  subjectTable: z.enum(["rooms", "equipment", "shipments"]),
  subjectId: z.uuid(),
  metric: z.string(),
  value: z.number(),
  recordedAt: z.coerce.date(),
  level: z.string().optional(),
});

export const TempExcursion = WorldScoped.extend({
  subjectTable: z.literal("shipments"),
  subjectId: z.uuid(),
  metric: z.literal("temp_c"),
  value: z.number(),
  recordedAt: z.coerce.date(),
});

export const SignalConfirmed = WorldScoped.extend({
  decisionRecordId: z.uuid(),
  subjectTable: z.string(),
  subjectCode: z.string(),
  metric: z.string(),
  summary: z.string(),
});

export const ReportSubmitted = WorldScoped.extend({
  reportedBy: z.string(),
  /** Free text from a person. Always passed to agents as untrusted data. */
  text: z.string().min(1).max(5000),
});

export const SupplierDelay = WorldScoped.extend({
  reportedBy: z.string(),
  supplier: z.string(),
  material: z.string().optional(),
  delayDays: z.number().int().positive(),
  /** The supplier's own message. Untrusted. */
  note: z.string().max(5000).optional(),
});

// ─── Incident chain ───

export const IncidentOpened = IncidentScoped;
export const IncidentDispatched = IncidentScoped;
export const EvidenceUpdated = IncidentScoped;
export const ImpactUpdated = IncidentScoped.extend({ decisionRecordId: z.uuid() });
export const RootCauseProposed = IncidentScoped.extend({ decisionRecordId: z.uuid() });
export const HoldApproved = IncidentScoped.extend({
  decisionRecordId: z.uuid(),
  kind: z.enum(["batches", "shipments"]),
  codes: z.array(z.string()),
});
export const ShortfallDetected = IncidentScoped.extend({ orderCode: z.string() });
export const RootCauseAccepted = IncidentScoped.extend({ decisionRecordId: z.uuid() });
/** Sent by the approval gate when a decision waits too long; it notifies, never moves authority. */
export const IncidentEscalated = IncidentScoped.extend({
  decisionRecordId: z.uuid(),
  owner: z.string(),
  notify: z.string(),
  reason: z.string(),
});

// ─── Orders ───

/** A person (or a scenario) logged an order; the Order Desk checks it. */
export const OrderReceived = WorldScoped.extend({ orderId: z.uuid() });
/** Code judged an order urgent (patient-critical or due soon, and not covered); the Scheduler plans it. */
export const OrderUrgent = WorldScoped.extend({ orderCode: z.string(), orderDeskDecisionId: z.uuid() });
/** The Devil's Advocate challenged a proposed root cause. */
export const ChallengeRaised = IncidentScoped.extend({ decisionRecordId: z.uuid(), challengesDecisionId: z.uuid() });

// ─── Decision Board and coordination ───

/** A seat raised a conflict; the Event Council advises the Executive. conflictId is the event id. */
export const BoardConvened = IncidentScoped.extend({
  conflictId: z.string().regex(/^\d+$/),
  summary: z.string(),
  fromSeat: SeatRole,
  withSeat: SeatRole,
});
/** A person resumed a paused incident; its waiting handlers continue. */
export const IncidentResumed = IncidentScoped;

// ─── Regulatory and communications ───

/** Regulatory Affairs confirmed a reporting obligation; the deadline is on the obligation row. */
export const ObligationConfirmed = IncidentScoped.extend({ obligationId: z.uuid(), ruleCode: z.string() });
/** An approved message in a live world is ready for the outbox to deliver. */
export const OutboundReady = z.object({ worldId: z.uuid(), messageId: z.uuid() });

// ─── Approvals ───

export const ApprovalRequested = IncidentScoped.extend({
  decisionRecordId: z.uuid(),
  seat: SeatRole,
  actionType: z.string(),
  severity: z.enum(["info", "watch", "warning", "critical"]),
});
export const DecisionResolved = IncidentScoped.extend({
  decisionRecordId: z.uuid(),
  approvalId: z.uuid(),
  outcome: z.enum(["approved", "rejected", "override", "more_evidence"]),
});

export interface Emitted {
  name: string;
  data: Record<string, unknown>;
}
