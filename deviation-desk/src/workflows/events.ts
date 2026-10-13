/**
 * Payloads of the events the first agent chain uses (names: docs/DOMAIN.md §Event names).
 * Handlers parse event data with these; nothing trusts an unchecked payload.
 */
import { z } from "zod";

const WorldScoped = z.object({ worldId: z.uuid(), companyId: z.uuid() });
const IncidentScoped = WorldScoped.extend({ incidentId: z.uuid() });

export const SensorAnomaly = WorldScoped.extend({
  subjectTable: z.enum(["rooms", "equipment", "shipments"]),
  subjectId: z.uuid(),
  metric: z.string(),
  value: z.number(),
  recordedAt: z.coerce.date(),
  level: z.string().optional(),
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

export const IncidentOpened = IncidentScoped;
export const EvidenceUpdated = IncidentScoped;
export const RootCauseProposed = IncidentScoped.extend({ decisionRecordId: z.uuid() });
export const ChallengeRaised = IncidentScoped.extend({ decisionRecordId: z.uuid(), challengesDecisionId: z.uuid() });
export const DecisionResolved = IncidentScoped.extend({
  decisionRecordId: z.uuid(),
  outcome: z.enum(["approved", "rejected", "override", "more_evidence"]),
});

export interface Emitted {
  name: string;
  data: Record<string, unknown>;
}
