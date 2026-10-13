/**
 * Records a human (or, in drills, AI-seat) decision on an agent proposal (CLAUDE.md principle 1).
 * Checks, all on the server:
 *  - the proposal needs approval, belongs to an incident, and has no final decision yet;
 *  - the seat may approve this action type (docs/AGENTS.md §Approvals);
 *  - in a live world, a person who holds that seat on the incident decides (the database also
 *    rejects live approvals without a person).
 */
import { z } from "zod";
import { APPROVING_SEATS } from "@/agents/approvals";
import { AgentAnswer, SeatRole } from "@/agents/contract";
import type { Sql } from "@/db/client";

export const ApprovalInput = z
  .object({
    worldId: z.uuid(),
    decisionRecordId: z.uuid(),
    seat: SeatRole,
    personId: z.uuid().nullable(),
    outcome: z.enum(["approved", "rejected", "override", "more_evidence"]),
    reason: z.string().max(2000).optional(),
  })
  .refine((a) => a.outcome === "approved" || (a.reason && a.reason.trim().length > 0), {
    message: "A reason is required to reject, override or ask for more evidence.",
  });
export type ApprovalInput = z.infer<typeof ApprovalInput>;

const FINAL = ["approved", "rejected", "override"] as const;

export interface RecordedApproval {
  approvalId: string;
  incidentId: string;
  companyId: string;
  actionType: string;
}

export async function recordApproval(sql: Sql, raw: ApprovalInput): Promise<RecordedApproval> {
  const input = ApprovalInput.parse(raw);
  return sql.begin(async (tx) => {
    // One decision at a time per proposal (two people clicking at once).
    await tx`select pg_advisory_xact_lock(hashtext(${`approval:${input.decisionRecordId}`}))`;

    const [decision] = await tx<{ record: { answer: unknown }; incidentId: string | null; companyId: string; requiresApproval: boolean; worldKind: string }[]>`
      select d.record, d.incident_id, d.company_id, d.requires_approval, w.kind as world_kind
      from decision_records d join worlds w on w.id = d.world_id
      where d.world_id = ${input.worldId} and d.id = ${input.decisionRecordId}`;
    if (!decision) throw new Error("Decision record not found in this world.");
    if (!decision.requiresApproval) throw new Error("This decision record does not ask for approval.");
    if (!decision.incidentId) throw new Error("Approvals belong to an incident; this proposal has none.");

    const answer = AgentAnswer.parse(decision.record.answer);
    const actionType = answer.proposedAction?.type;
    if (!actionType) throw new Error("The proposal has no action to approve.");
    const allowed = APPROVING_SEATS[actionType] ?? [];
    if (!allowed.includes(input.seat)) {
      throw new Error(`The ${input.seat} seat cannot decide "${actionType}". Allowed: ${allowed.join(", ") || "none"}.`);
    }

    const [final] = await tx`
      select outcome from approvals
      where world_id = ${input.worldId} and decision_record_id = ${input.decisionRecordId} and outcome in ${tx(FINAL)}`;
    if (final) throw new Error(`This proposal was already ${String(final.outcome)}.`);

    if (decision.worldKind === "live" && !input.personId) {
      throw new Error("In a live world a person must make this decision.");
    }
    if (input.personId) {
      const [seated] = await tx`
        select 1 from seats
        where world_id = ${input.worldId} and incident_id = ${decision.incidentId}
          and role = ${input.seat} and person_id = ${input.personId}`;
      if (!seated) throw new Error(`That person does not hold the ${input.seat} seat on this incident.`);
    }

    const [approval] = await tx<{ id: string }[]>`
      insert into approvals ${tx({
        worldId: input.worldId,
        companyId: decision.companyId,
        decisionRecordId: input.decisionRecordId,
        seat: input.seat,
        personId: input.personId,
        outcome: input.outcome,
        reason: input.reason ?? null,
      })}
      returning id`;
    if (!approval) throw new Error("Failed to record approval");

    await tx`insert into incident_events ${tx({
      worldId: input.worldId,
      companyId: decision.companyId,
      incidentId: decision.incidentId,
      actorType: input.personId ? "human" : "system",
      actorId: input.personId ?? "ai_seat",
      seat: input.seat,
      eventType: "decision_recorded",
      payload: tx.json({ decisionRecordId: input.decisionRecordId, approvalId: approval.id, actionType, outcome: input.outcome, reason: input.reason ?? null }),
    })}`;

    return { approvalId: approval.id, incidentId: decision.incidentId, companyId: decision.companyId, actionType };
  });
}
