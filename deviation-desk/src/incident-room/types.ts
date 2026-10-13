/**
 * View shapes for the Incident Room. Plain, serializable data (dates as ISO strings) so server
 * components can hand them to client components. Agent output shapes come from the contract.
 */
import type { AgentAnswer, SeatRole } from "@/agents/contract";
import type { SceneData } from "@/voxel/types";

export type Severity = "info" | "watch" | "warning" | "critical";

/** Seats a person can take in a live incident, in display order. Facilitator is drill-only. */
export const LIVE_SEATS = [
  "qa_director",
  "plant_manager",
  "supply_chain_lead",
  "regulatory_affairs",
  "clinical_ops",
  "executive",
  "strategy_growth",
  "observer",
] as const satisfies readonly SeatRole[];
export type LiveSeat = (typeof LIVE_SEATS)[number];

export const SEAT_LABELS: Record<SeatRole, string> = {
  qa_director: "QA Director",
  plant_manager: "Plant Manager",
  supply_chain_lead: "Supply Chain Lead",
  regulatory_affairs: "Regulatory Affairs",
  clinical_ops: "Clinical Ops Manager",
  executive: "Executive",
  strategy_growth: "Strategy & Growth",
  observer: "Observer",
  facilitator: "Facilitator",
};

export interface IncidentSummary {
  id: string;
  code: string;
  title: string;
  incidentType: string;
  severity: Severity;
  status: string;
  openedAt: string;
  pendingDecisions: number;
}

export interface SeatView {
  role: SeatRole;
  label: string;
  /** Null when the seat is played by AI. */
  holder: { personId: string; name: string } | null;
  /** Agents that work for this seat and have run on the incident. */
  agents: string[];
  pendingDecisions: number;
}

export type DecisionStatus = "none" | "pending" | "more_evidence" | "approved" | "rejected" | "override";

export interface AgentCard {
  decisionRecordId: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  kind: AgentAnswer["kind"];
  summary: string;
  reasoning: string;
  confidence: AgentAnswer["confidence"];
  confidenceScore: number | null;
  sources: AgentAnswer["sources"];
  alternatives: AgentAnswer["alternatives"];
  requiresApproval: boolean;
  approvalSeat: SeatRole | null;
  /** Seats that may decide this action (docs/AGENTS.md §Approvals). */
  decidingSeats: SeatRole[];
  action: { type: string; label: string; params: Record<string, unknown> } | null;
  status: DecisionStatus;
  decision: { seat: SeatRole; by: string | null; reason: string | null; at: string } | null;
  rejectedSourceCount: number;
  /** Regulator A's advice on this proposal (critical incidents). Advice, never a ruling. */
  advisories: Advisory[];
}

export interface Advisory {
  decisionRecordId: string;
  agentName: string;
  summary: string;
  reasoning: string;
}

export interface ObligationView {
  id: string;
  ruleCode: string;
  title: string;
  authority: string;
  fictional: boolean;
  clockStartedAt: string;
  dueAt: string;
  /** Hours until due in the world's clock; negative once overdue. */
  hoursLeft: number;
  submission: { status: MessageStatus; subject: string } | null;
}

export type MessageStatus = "ready" | "sent" | "failed" | "not_configured" | "drill";

export interface MessageView {
  id: string;
  actionType: string;
  label: string;
  audience: string;
  to: string[];
  subject: string;
  body: string;
  status: MessageStatus;
  lastError: string | null;
  createdAt: string;
}

export interface FeedItem {
  id: string;
  at: string;
  actorKind: "ai" | "human" | "system";
  actor: string;
  text: string;
  decisionRecordId: string | null;
}

export interface EvidenceItem {
  id: string;
  sourceTable: string;
  sourceId: string | null;
  note: string;
  addedByType: "agent" | "human";
  addedBy: string;
  createdAt: string;
}

export type RoomTint = "critical" | "at_risk" | "clear";

export interface MapRoom {
  id: string;
  name: string;
  department: string;
  x: number;
  y: number;
  w: number;
  d: number;
  tint: RoomTint;
  /** Why the room is tinted, in plain words. */
  reasons: string[];
}

export interface ConflictItem {
  id: string;
  at: string;
  raisedBy: string;
  fromSeat: SeatRole;
  withSeat: SeatRole;
  summary: string;
  resolution: { by: string; note: string; at: string } | null;
  /** The Event Council's advice: one vote per member. */
  votes: CouncilVote[];
}

export interface CouncilVote {
  member: string;
  favors: "raising_seat" | "other_seat" | "neither";
  position: string;
  decisionRecordId: string;
}

export interface IncidentRoomView {
  incident: IncidentSummary;
  objects: Array<{ table: string; code: string }>;
  seats: SeatView[];
  mySeat: SeatRole | null;
  cards: AgentCard[];
  pendingForMe: AgentCard[];
  feed: FeedItem[];
  evidence: EvidenceItem[];
  map: MapRoom[];
  spreadPaths: string[];
  conflicts: ConflictItem[];
  /** Set while the incident is paused (the Coordinator proposed it, the Executive approved). */
  paused: { reason: string; at: string } | null;
  /** Confirmed reporting obligations and the outbox. */
  regulatory: { obligations: ObligationView[]; messages: MessageView[] };
  /** Everything the voxel world draws. */
  scene: SceneData;
}
