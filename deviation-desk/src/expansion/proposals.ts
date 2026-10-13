/**
 * Expansion proposals: created from an agent's propose_expansion finding, priced in code, decided
 * by people. Strategy & Growth decides; spend at or above EXECUTIVE_SPEND_USD also needs the
 * Executive (docs/AGENTS.md §Approvals: approve_expansion). Decisions are append-only rows.
 */
import type { Sql } from "@/db/client";
import { Change, checkChange, estimateCost } from "./change";

export const EXECUTIVE_SPEND_USD = 250_000;

export interface NewProposal {
  title: string;
  summary: string;
  change: unknown;
}

export type CreateResult = { ok: true; id: string; code: string; costUsd: number } | { ok: false; problems: string[] };

export async function createProposal(sql: Sql, worldId: string, companyId: string, input: NewProposal, proposedBy: string, decisionRecordId: string | null): Promise<CreateResult> {
  const parsed = Change.safeParse(input.change);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "change"}: ${i.message}`) };
  const problems = await checkChange(sql, worldId, parsed.data);
  const [same] = await sql<{ code: string }[]>`
    select code from expansion_proposals where world_id = ${worldId} and status = 'proposed' and change = ${sql.json(parsed.data as unknown as Parameters<typeof sql.json>[0])}`;
  if (same) problems.push(`The same change is already proposed as ${same.code}.`);
  if (problems.length > 0) return { ok: false, problems };
  const cost = await estimateCost(sql, worldId, parsed.data);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`expansion-code:${worldId}`}))`;
    const [{ next } = { next: 1 }] = await tx<{ next: number }[]>`
      select coalesce(max(substring(code from '^EXP-(\\d+)$')::int), 0) + 1 as next from expansion_proposals where world_id = ${worldId}`;
    const code = `EXP-${String(next).padStart(3, "0")}`;
    const [row] = await tx<{ id: string }[]>`
      insert into expansion_proposals ${tx({
        worldId,
        companyId,
        code,
        kind: parsed.data.kind,
        title: input.title.slice(0, 200),
        summary: input.summary.slice(0, 2000),
        change: tx.json(parsed.data as unknown as Parameters<typeof tx.json>[0]),
        estimatedCostUsd: cost.costUsd,
        leadTimeMonths: cost.leadTimeMonths,
        proposedBy,
        decisionRecordId,
      })}
      returning id`;
    if (!row) throw new Error("Failed to record the proposal");
    return { ok: true, id: row.id, code, costUsd: cost.costUsd };
  });
}

export interface DecisionInput {
  worldId: string;
  proposalId: string;
  personId: string;
  outcome: "approved" | "rejected";
  reason?: string;
}

/**
 * Records a person's decision. The person's standing seat decides what they may do: Strategy &
 * Growth decides every proposal; the Executive co-signs spend at or above the threshold. Returns the
 * proposal's status after the decision.
 */
export async function decideProposal(sql: Sql, input: DecisionInput): Promise<{ status: "proposed" | "approved" | "rejected"; waitingFor: "executive" | null }> {
  if (input.outcome === "rejected" && !input.reason?.trim()) throw new Error("A reason is required to reject a proposal.");
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`expansion-decision:${input.proposalId}`}))`;
    const [p] = await tx<{ companyId: string; status: string; cost: string }[]>`
      select company_id, status, estimated_cost_usd as cost from expansion_proposals where world_id = ${input.worldId} and id = ${input.proposalId}`;
    if (!p) throw new Error("Proposal not found.");
    if (p.status !== "proposed") throw new Error(`This proposal was already ${p.status}.`);
    const [person] = await tx<{ standingSeat: string | null }[]>`select standing_seat from people where world_id = ${input.worldId} and id = ${input.personId}`;
    const seat = person?.standingSeat;
    if (seat !== "strategy_growth" && seat !== "executive") throw new Error("Only Strategy & Growth or the Executive decide expansion proposals.");
    const needsExecutive = Number(p.cost) >= EXECUTIVE_SPEND_USD;
    const prior = await tx<{ seat: string; outcome: string }[]>`
      select seat, outcome from expansion_decisions where world_id = ${input.worldId} and proposal_id = ${input.proposalId}`;
    if (prior.some((d) => d.seat === seat)) throw new Error(`The ${seat === "executive" ? "Executive" : "Strategy & Growth"} seat already decided this proposal.`);
    if (seat === "executive" && !needsExecutive) throw new Error("This proposal is under the spend threshold; Strategy & Growth decides it.");

    await tx`insert into expansion_decisions ${tx({ worldId: input.worldId, companyId: p.companyId, proposalId: input.proposalId, personId: input.personId, seat, outcome: input.outcome, reason: input.reason ?? null })}`;
    const decided = [...prior, { seat, outcome: input.outcome }];
    let status: "proposed" | "approved" | "rejected" = "proposed";
    if (decided.some((d) => d.outcome === "rejected")) status = "rejected";
    else if (decided.some((d) => d.seat === "strategy_growth") && (!needsExecutive || decided.some((d) => d.seat === "executive"))) status = "approved";
    if (status !== "proposed") await tx`update expansion_proposals set status = ${status} where world_id = ${input.worldId} and id = ${input.proposalId}`;
    const waitingFor = status === "proposed" && needsExecutive && !decided.some((d) => d.seat === "executive") ? "executive" : null;
    return { status, waitingFor };
  });
}
