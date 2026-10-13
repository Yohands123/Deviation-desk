/** Reads for the Strategy page: proposals with their simulations, readiness, ranking and decisions. */
import "server-only";
import { AgentAnswer, type SeatRole } from "@/agents/contract";
import { getSql } from "@/db/client";
import type { Viewer } from "@/incident-room/viewer";
import { compareStress, type ComparisonRow } from "./compare";
import { EXECUTIVE_SPEND_USD } from "./proposals";
import type { StressResult } from "./simulate";

export interface AgentNote {
  decisionRecordId: string;
  agentId: string;
  summary: string;
  reasoning: string;
  params: Record<string, unknown>;
  at: string;
}

export interface ProposalView {
  id: string;
  code: string;
  kind: string;
  title: string;
  summary: string;
  change: Record<string, unknown>;
  estimatedCostUsd: number;
  leadTimeMonths: number;
  status: "proposed" | "approved" | "rejected";
  proposedBy: string;
  createdAt: string;
  needsExecutive: boolean;
  simulation: { rows: ComparisonRow[]; at: string } | null;
  readiness: AgentNote | null;
  decisions: Array<{ seat: string; outcome: string; by: string; reason: string | null; at: string }>;
}

export interface StrategyPage {
  proposals: ProposalView[];
  ranking: AgentNote | null;
  launchNotes: AgentNote[];
  /** Planner findings from the latest review that proposed nothing. */
  reviewNotes: AgentNote[];
  standingSeat: SeatRole | null;
  spendThresholdUsd: number;
}

async function notes(worldId: string, agents: string[]): Promise<AgentNote[]> {
  const rows = await getSql()<{ id: string; agentId: string; record: { answer: unknown }; createdAt: Date }[]>`
    select id, agent_id, record, created_at from decision_records
    where world_id = ${worldId} and incident_id is null and agent_id in ${getSql()(agents)}
    order by created_at desc limit 40`;
  return rows.flatMap((r) => {
    const a = AgentAnswer.safeParse(r.record.answer);
    if (!a.success) return [];
    return [{ decisionRecordId: r.id, agentId: r.agentId, summary: a.data.summary, reasoning: a.data.reasoning, params: a.data.proposedAction?.params ?? {}, at: r.createdAt.toISOString() }];
  });
}

export async function getStrategyPage(viewer: Viewer): Promise<StrategyPage> {
  const sql = getSql();
  const w = viewer.worldId;
  const proposals = await sql<
    Array<{ id: string; code: string; kind: string; title: string; summary: string; change: Record<string, unknown>; estimatedCostUsd: string; leadTimeMonths: number; status: ProposalView["status"]; proposedBy: string; createdAt: Date; baseline: StressResult | null; withChange: StressResult | null; simulatedAt: Date | null }>
  >`
    select p.id, p.code, p.kind, p.title, p.summary, p.change, p.estimated_cost_usd, p.lead_time_months, p.status, p.proposed_by, p.created_at,
      s.baseline, s.with_change, s.created_at as simulated_at
    from expansion_proposals p
    left join lateral (select baseline, with_change, created_at from expansion_simulations s where s.world_id = p.world_id and s.proposal_id = p.id order by created_at desc limit 1) s on true
    where p.world_id = ${w}
    order by p.status <> 'proposed', p.created_at desc`;
  const decisions = await sql<{ proposalId: string; seat: string; outcome: string; by: string; reason: string | null; createdAt: Date }[]>`
    select d.proposal_id, d.seat, d.outcome, p.name as by, d.reason, d.created_at
    from expansion_decisions d join people p on p.world_id = d.world_id and p.id = d.person_id
    where d.world_id = ${w} order by d.created_at`;
  const [me] = await sql<{ standingSeat: SeatRole | null }[]>`select standing_seat from people where world_id = ${w} and id = ${viewer.personId}`;

  const readiness = await notes(w, ["readiness_checker"]);
  const ranking = (await notes(w, ["expansion_lead"]))[0] ?? null;
  const planners = await notes(w, ["capacity_planner", "network_planner", "supplier_scout"]);
  const launchNotes = await notes(w, ["launch_planner"]);

  return {
    proposals: proposals.map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind,
      title: p.title,
      summary: p.summary,
      change: p.change,
      estimatedCostUsd: Number(p.estimatedCostUsd),
      leadTimeMonths: p.leadTimeMonths,
      status: p.status,
      proposedBy: p.proposedBy,
      createdAt: p.createdAt.toISOString(),
      needsExecutive: Number(p.estimatedCostUsd) >= EXECUTIVE_SPEND_USD,
      simulation: p.baseline && p.withChange && p.simulatedAt ? { rows: compareStress(p.baseline, p.withChange), at: p.simulatedAt.toISOString() } : null,
      readiness: readiness.find((r) => r.params.proposalCode === p.code) ?? null,
      decisions: decisions.filter((d) => d.proposalId === p.id).map(({ proposalId: _, createdAt, ...d }) => ({ ...d, at: createdAt.toISOString() })),
    })),
    ranking,
    launchNotes,
    // Planner findings newer than the latest ranking that did not become proposals.
    reviewNotes: planners.filter((n) => n.params.title === undefined && (!ranking || n.at >= new Date(Date.parse(ranking.at) - 3_600_000).toISOString())).slice(0, 3),
    standingSeat: me?.standingSeat ?? null,
    spendThresholdUsd: EXECUTIVE_SPEND_USD,
  };
}
