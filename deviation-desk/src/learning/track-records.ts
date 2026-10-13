/**
 * Agent track records: how each agent's work has fared with the people who decide, computed from
 * the append-only records (agent runs, decision records, approvals). Live and drill work are kept
 * apart, since AI-played seats approve in drills.
 */
import type { Sql } from "@/db/client";

export interface TrackRecord {
  agentId: string;
  runs: number;
  costUsd: number;
  avgLatencySeconds: number | null;
  /** Runs that failed validation, hit the budget or errored. */
  failedRuns: number;
  proposals: number;
  approved: number;
  rejected: number;
  overridden: number;
  moreEvidence: number;
  pending: number;
  /** Approved share of decided proposals; null before any decision. */
  approvalRate: number | null;
  /** Cited sources that did not exist and were removed (must stay zero). */
  fabricatedSources: number;
  activeLessons: number;
  lastRunAt: string | null;
}

export async function trackRecords(sql: Sql, companyId: string, kind: "live" | "drill" = "live", sinceDays = 90): Promise<TrackRecord[]> {
  const rows = await sql<
    Array<Omit<TrackRecord, "costUsd" | "avgLatencySeconds" | "approvalRate" | "lastRunAt"> & { costUsd: string; avgLatencyMs: string | null; lastRunAt: Date | null }>
  >`
    with w as (select id from worlds where company_id = ${companyId} and kind = ${kind}),
    since as (select now() - make_interval(days => ${sinceDays}) as t),
    runs as (
      select agent_id, count(*)::int as runs, coalesce(sum(cost_usd), 0) as cost_usd, avg(latency_ms) as avg_latency_ms,
        count(*) filter (where status in ('invalid', 'budget_exceeded', 'error'))::int as failed_runs, max(created_at) as last_run_at
      from agent_runs where world_id in (select id from w) and created_at > (select t from since) group by agent_id
    ),
    final as (
      select distinct on (a.world_id, a.decision_record_id) a.world_id, a.decision_record_id, a.outcome
      from approvals a where a.world_id in (select id from w) and a.outcome <> 'more_evidence'
      order by a.world_id, a.decision_record_id, a.created_at desc
    ),
    recs as (
      select d.agent_id,
        count(*) filter (where d.requires_approval)::int as proposals,
        count(*) filter (where f.outcome = 'approved')::int as approved,
        count(*) filter (where f.outcome = 'rejected')::int as rejected,
        count(*) filter (where f.outcome = 'override')::int as overridden,
        count(*) filter (where d.requires_approval and f.outcome is null)::int as pending,
        coalesce(sum(jsonb_array_length(coalesce(d.record -> 'rejectedSources', '[]'::jsonb))), 0)::int as fabricated_sources,
        coalesce(sum((select count(*) from approvals m where m.world_id = d.world_id and m.decision_record_id = d.id and m.outcome = 'more_evidence')), 0)::int as more_evidence
      from decision_records d
      left join final f on f.world_id = d.world_id and f.decision_record_id = d.id
      where d.world_id in (select id from w) and d.created_at > (select t from since)
      group by d.agent_id
    ),
    lessons as (select agent_id, count(*)::int as active_lessons from agent_lessons where company_id = ${companyId} and status = 'active' group by agent_id)
    select c.id as agent_id,
      coalesce(r.runs, 0) as runs, coalesce(r.cost_usd, 0) as cost_usd, r.avg_latency_ms, coalesce(r.failed_runs, 0) as failed_runs,
      coalesce(x.proposals, 0) as proposals, coalesce(x.approved, 0) as approved, coalesce(x.rejected, 0) as rejected,
      coalesce(x.overridden, 0) as overridden, coalesce(x.more_evidence, 0) as more_evidence, coalesce(x.pending, 0) as pending,
      coalesce(x.fabricated_sources, 0) as fabricated_sources, coalesce(l.active_lessons, 0) as active_lessons, r.last_run_at
    from agent_configs c
    left join runs r on r.agent_id = c.id
    left join recs x on x.agent_id = c.id
    left join lessons l on l.agent_id = c.id
    order by coalesce(r.runs, 0) desc, c.id`;
  return rows.map(({ costUsd, avgLatencyMs, lastRunAt, ...r }) => {
    const decided = r.approved + r.rejected + r.overridden;
    return {
      ...r,
      costUsd: Math.round(Number(costUsd) * 1000) / 1000,
      avgLatencySeconds: avgLatencyMs === null ? null : Math.round(Number(avgLatencyMs) / 100) / 10,
      approvalRate: decided > 0 ? Math.round((r.approved / decided) * 100) / 100 : null,
      lastRunAt: lastRunAt?.toISOString() ?? null,
    };
  });
}

export interface ReviewItem {
  decisionRecordId: string;
  agentId: string;
  actionType: string | null;
  summary: string;
  outcome: "rejected" | "override" | "more_evidence";
  seat: string;
  reason: string | null;
  at: string;
}

/** What people pushed back on in one world (the live one, in practice): rejections, overrides and requests for more evidence, with reasons. */
export async function pushback(sql: Sql, worldId: string, sinceDays = 30, limit = 40): Promise<ReviewItem[]> {
  const rows = await sql<Array<Omit<ReviewItem, "at"> & { at: Date }>>`
    select d.id as decision_record_id, d.agent_id, d.record -> 'answer' -> 'proposedAction' ->> 'type' as action_type,
      d.record -> 'answer' ->> 'summary' as summary, a.outcome, a.seat, a.reason, a.created_at as at
    from approvals a
    join decision_records d on d.world_id = a.world_id and d.id = a.decision_record_id
    where a.world_id = ${worldId} and a.outcome in ('rejected', 'override', 'more_evidence')
      and a.created_at > now() - make_interval(days => ${sinceDays})
    order by a.created_at desc limit ${limit}`;
  return rows.map(({ at, ...r }) => ({ ...r, at: at.toISOString() }));
}
