/**
 * Entry point for a person's decision on a proposal (the Incident Room's decision card):
 * records the approval with every server-side check, then resumes the waiting workflow.
 */
import "server-only";
import { ApprovalInput, recordApproval } from "@/approvals/record-approval";
import { getSql } from "@/db/client";
import { emit } from "./emit";

export async function resolveDecision(input: ApprovalInput): Promise<{ approvalId: string; resumed: boolean }> {
  const approval = await recordApproval(getSql(), ApprovalInput.parse(input));
  const resumed = await emit({
    name: "decision/resolved",
    data: {
      worldId: input.worldId,
      companyId: approval.companyId,
      incidentId: approval.incidentId,
      decisionRecordId: input.decisionRecordId,
      approvalId: approval.approvalId,
      outcome: input.outcome,
    },
  });
  return { approvalId: approval.approvalId, resumed };
}
