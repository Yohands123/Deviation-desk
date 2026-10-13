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
