/**
 * What happens when nobody decides on a proposal in time (Layer 4, CLAUDE.md §8).
 * Escalation notifies; it never moves authority. Only the seats in docs/AGENTS.md §Approvals may
 * decide, however long it takes, so a regulatory or quality sign-off stays with its owner.
 */
import type { SeatRole } from "@/agents/contract";

export type Severity = "info" | "watch" | "warning" | "critical";

/** How long the owning seat has before others are told. Configurable per customer later. */
export const RESPONSE_TIME: Record<Severity, string> = {
  critical: "30m",
  warning: "2h",
  watch: "8h",
  info: "24h",
};

const ESCALATE_TO: Partial<Record<SeatRole, SeatRole>> = {
  qa_director: "executive",
  plant_manager: "executive",
  supply_chain_lead: "executive",
  regulatory_affairs: "executive",
  clinical_ops: "executive",
  strategy_growth: "executive",
};

export interface EscalationStep {
  /** How long to wait for a decision before this step fires. */
  wait: string;
  /** Seat to notify, or null when the step marks the decision overdue. */
  notify: SeatRole | null;
}

export function escalationPlan(seat: SeatRole, severity: Severity): EscalationStep[] {
  const wait = RESPONSE_TIME[severity];
  const next = ESCALATE_TO[seat];
  return next ? [{ wait, notify: next }, { wait, notify: null }] : [{ wait, notify: null }];
}
