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
