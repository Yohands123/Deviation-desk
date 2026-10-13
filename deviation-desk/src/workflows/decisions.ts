/**
 * Entry point for a person's decision on a proposal (the Incident Room calls this in Phase 4):
 * records the approval with every server-side check, then resumes the waiting workflow.
 */
import "server-only";
import { ApprovalInput, recordApproval } from "@/approvals/record-approval";
import { getSql } from "@/db/client";
import { inngest } from "./client";

export async function resolveDecision(input: ApprovalInput): Promise<{ approvalId: string }> {
  const approval = await recordApproval(getSql(), ApprovalInput.parse(input));
  await inngest.send({
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
  return { approvalId: approval.approvalId };
}
