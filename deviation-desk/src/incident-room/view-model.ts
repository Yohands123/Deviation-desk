/**
 * Pure helpers that turn database rows into what the Incident Room shows. No I/O; unit-tested.
 */
import type { SeatRole } from "@/agents/contract";
import { SEAT_LABELS, type AgentCard, type DecisionStatus, type FeedItem, type RoomTint } from "./types";

const ACTION_LABELS: Record<string, string> = {
  accept_root_cause: "Accept root cause",
  hold_batch: "Hold batches",
  hold_shipment: "Hold shipments",
  reroute_supply: "Reroute supply",
  contact_supplier: "Contact supplier",
  quarantine_location: "Quarantine location",
  halt_line: "Halt line",
  restart_line: "Restart line",
  recall: "Recall",
  run_test: "Run test",
  open_incident: "Open incident",
  link_to_incident: "Link to incident",
  activate_agents: "Activate agents",
  confirm_signal: "Confirm signal",
  confirm_reporting_obligation: "Confirm reporting obligation",
  submit_notification: "Submit to the regulator",
  notify_customer: "Notify customer",
  notify_trial_site: "Notify trial site",
  notify_staff: "Brief staff",
};

export function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const CONFIDENCE_WORD: Record<AgentCard["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  insufficient: "Not enough evidence",
};

const CONFIDENCE_BAND: Record<AgentCard["confidence"], { min: number; max: number; mid: number }> = {
  high: { min: 0.7, max: 1, mid: 0.85 },
  medium: { min: 0.4, max: 0.8, mid: 0.6 },
  low: { min: 0.1, max: 0.5, mid: 0.3 },
  insufficient: { min: 0, max: 0.2, mid: 0.05 },
};

/** The agent's numeric score, but only when it agrees with its confidence word; the word wins. */
export function consistentScore(confidence: AgentCard["confidence"], score: number | null): number | null {
  const band = CONFIDENCE_BAND[confidence];
  return score !== null && score >= band.min && score <= band.max ? score : null;
}

/** 0..1 for the confidence bar: a consistent score, otherwise the word's midpoint. */
export function confidenceFill(confidence: AgentCard["confidence"], score: number | null): number {
  return consistentScore(confidence, score) ?? CONFIDENCE_BAND[confidence].mid;
}

export interface ApprovalRow {
  decisionRecordId: string;
  outcome: "approved" | "rejected" | "override" | "more_evidence";
  seat: SeatRole;
  by: string | null;
  reason: string | null;
  at: string;
}

/** A decision is settled by its final approval; "more evidence" keeps it open. Rows oldest first. */
export function decisionStatus(requiresApproval: boolean, approvals: ApprovalRow[]): { status: DecisionStatus; decision: ApprovalRow | null } {
  if (!requiresApproval) return { status: "none", decision: null };
  const final = approvals.find((a) => a.outcome !== "more_evidence");
  if (final) return { status: final.outcome, decision: final };
  const asked = approvals.at(-1);
  return asked ? { status: "more_evidence", decision: asked } : { status: "pending", decision: null };
}

export const isOpen = (card: Pick<AgentCard, "status">) => card.status === "pending" || card.status === "more_evidence";

/** Open proposals this seat may decide. */
export function pendingFor(seat: SeatRole | null, cards: AgentCard[]): AgentCard[] {
  if (!seat) return [];
  return cards.filter((c) => isOpen(c) && c.decidingSeats.includes(seat));
}

export interface EventRow {
  id: string;
  at: string;
  actorType: "agent" | "human" | "watcher" | "system" | "saboteur";
  actorId: string;
  seat: SeatRole | null;
  eventType: string;
  payload: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : "");

/** Plain-language feed line for a timeline event, or null for bookkeeping events. */
export function describeEvent(e: EventRow, names: { people: Map<string, string>; agents: Map<string, string> }): FeedItem | null {
  const person = names.people.get(e.actorId) ?? "Someone";
  const seat = e.seat ? SEAT_LABELS[e.seat] : null;
  const p = e.payload;
  const base = { id: `event:${e.id}`, at: e.at, decisionRecordId: str(p.decisionRecordId) || null };
  const system = (text: string): FeedItem => ({ ...base, actorKind: "system", actor: "Deviation Desk", text });
  const human = (text: string): FeedItem => ({ ...base, actorKind: "human", actor: seat ? `${person} (${seat})` : person, text });

  switch (e.eventType) {
    case "opened":
      return system("Incident opened.");
    case "reported":
      return human(`Reported: ${str(p.summary)}`);
    case "agents_activated":
      return { ...base, actorKind: "ai", actor: "Dispatcher", text: `Activated ${list(p.agents) || "no agents"}.` };
    case "approval_requested":
      return system(`${actionLabel(str(p.actionType))} is waiting for the ${SEAT_LABELS[p.seat as SeatRole] ?? str(p.seat)}.`);
    case "decision_recorded": {
      const verb = { approved: "approved", rejected: "rejected", override: "overrode", more_evidence: "asked for more evidence on" }[str(p.outcome)] ?? str(p.outcome);
      const who = e.actorType === "human" ? undefined : `AI-played ${seat ?? "seat"}`;
      const text = `${verb[0]?.toUpperCase()}${verb.slice(1)} "${actionLabel(str(p.actionType))}"${p.reason ? `: ${str(p.reason)}` : "."}`;
      return who ? { ...base, actorKind: "ai", actor: who, text } : human(text);
    }
    case "action_executed":
      return system(`Done: ${actionLabel(str(p.actionType))}.`);
    case "action_failed":
      return system(`Could not complete ${actionLabel(str(p.actionType))}: ${str(p.reason)}`);
    case "action_not_automated":
      return system(`${actionLabel(str(p.actionType))} approved; carry it out by hand.`);
    case "approval_escalated":
      return system(`No decision yet; the ${SEAT_LABELS[p.notified as SeatRole] ?? "next seat"} has been told.`);
    case "approval_overdue":
      return system(`A decision for the ${SEAT_LABELS[p.owner as SeatRole] ?? "owner"} is overdue.`);
    case "seat_taken":
      return e.actorType === "human" ? human(`Took the ${seat ?? "seat"} seat.`) : null;
    case "evidence_added":
      return human(`Added evidence: ${str(p.note)}`);
    case "recheck_requested":
      return human("Asked the agents to re-check the evidence.");
    case "conflict_raised":
      return human(`Raised a conflict with the ${SEAT_LABELS[p.withSeat as SeatRole] ?? "other seat"}: ${str(p.summary)}`);
    case "conflict_resolved":
      return human(`Resolved a conflict: ${str(p.note)}`);
    case "closed":
      return human(`Closed the incident: ${str(p.reason)}`);
    case "paused":
      return system(`Paused by the Executive's decision: ${str(p.reason)} Agent work waits until it is resumed.`);
    case "resumed":
      return human("Resumed the incident; waiting agent work continues.");
    case "linked_report":
      return { ...base, actorKind: "ai", actor: names.agents.get("intake_triage") ?? "Intake Triage", text: `Linked a new report: ${str(p.summary)}` };
    default:
      return null;
  }
}

export function feedFromCards(cards: AgentCard[]): FeedItem[] {
  return cards.map((c) => ({
    id: `decision:${c.decisionRecordId}`,
    at: c.createdAt,
    actorKind: "ai" as const,
    actor: c.agentName,
    text: c.summary,
    decisionRecordId: c.decisionRecordId,
  }));
}

/** Newest first. */
export function mergeFeed(...lists: FeedItem[][]): FeedItem[] {
  return lists.flat().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id.localeCompare(b.id)));
}

/** Critical outranks at risk; a room's own status counts too. */
export function roomTint(ownStatus: string, critical: boolean, atRisk: boolean): RoomTint {
  if (critical || ownStatus === "critical" || ownStatus === "locked") return "critical";
  if (atRisk || ownStatus === "at_risk" || ownStatus === "watch") return "at_risk";
  return "clear";
}
