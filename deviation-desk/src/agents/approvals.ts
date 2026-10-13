/**
 * Which seat may approve which proposed action (docs/AGENTS.md §Approvals).
 * Every action listed here is consequential: an agent may only propose it with
 * requiresApproval = true and an approving seat from this table (CLAUDE.md principle 1).
 */
import type { AgentAnswer, SeatRole } from "./contract";

export const APPROVING_SEATS: Readonly<Record<string, readonly SeatRole[]>> = {
  accept_root_cause: ["qa_director"],
  run_test: ["qa_director"],
  approve_capa: ["qa_director"],
  hold_batch: ["qa_director", "plant_manager"],
  quarantine_location: ["qa_director", "plant_manager"],
  halt_line: ["plant_manager"],
  restart_line: ["plant_manager"],
  reassign_staff: ["plant_manager"],
  hold_shipment: ["supply_chain_lead"],
  reroute_supply: ["supply_chain_lead"],
  contact_supplier: ["supply_chain_lead"],
  confirm_reporting_obligation: ["regulatory_affairs"],
  submit_notification: ["regulatory_affairs"],
  notify_trial_site: ["clinical_ops"],
  reallocate_trial_supply: ["clinical_ops"],
  recall: ["executive"],
  resolve_board_conflict: ["executive"],
  approve_expansion: ["strategy_growth"],
  run_scenario: ["facilitator"],
  inject_event: ["facilitator"],
};

export function isConsequential(actionType: string): boolean {
  return Object.hasOwn(APPROVING_SEATS, actionType);
}

/** Returns why an answer breaks the approval rules, or null if it is fine. */
export function approvalProblem(answer: AgentAnswer): string | null {
  const action = answer.proposedAction;
  if (!action) return answer.requiresApproval ? "requiresApproval is true but there is no proposedAction." : null;

  if (isConsequential(action.type)) {
    const seats = APPROVING_SEATS[action.type] ?? [];
    if (!answer.requiresApproval) {
      return `"${action.type}" is a consequential action and must set requiresApproval to true.`;
    }
    if (!answer.approvalSeat || !seats.includes(answer.approvalSeat)) {
      return `"${action.type}" must be approved by ${seats.join(" or ")}, not ${answer.approvalSeat ?? "no seat"}.`;
    }
    return null;
  }

  if (answer.requiresApproval) {
    return `"${action.type}" is not an approvable action type. Use one from docs/AGENTS.md §Approvals or set requiresApproval to false.`;
  }
  return null;
}
