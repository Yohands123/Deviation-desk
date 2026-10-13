import { defaultAgents } from "@/agents/registry";
import { cx, Panel, timeLabel } from "@/components/ui";
import { WorldRealtime } from "@/components/world-realtime";
import { getSql } from "@/db/client";
import { requireViewer } from "@/incident-room/viewer";
import { trackRecords } from "@/learning/track-records";
import { DecideLesson, RunLearning } from "./agents-client";

const NAMES = new Map(defaultAgents.map((a) => [a.id, a.name]));
const DEPARTMENTS = new Map(defaultAgents.map((a) => [a.id, a.department.replace(/_/g, " ")]));

export default async function AgentsPage() {
  const viewer = await requireViewer();
  const sql = getSql();
  const records = await trackRecords(sql, viewer.companyId, "live");
  const lessons = await sql<
    Array<{ id: string; agentId: string; lesson: string; rationale: string; status: "proposed" | "active" | "rejected" | "retired"; decidedBy: string | null; decidedAt: Date | null; decisionReason: string | null; createdAt: Date }>
  >`
    select l.id, l.agent_id, l.lesson, l.rationale, l.status, p.name as decided_by, l.decided_at, l.decision_reason, l.created_at
    from agent_lessons l left join people p on p.world_id = l.world_id and p.id = l.decided_by
    where l.world_id = ${viewer.worldId}
    order by l.status <> 'proposed', l.status <> 'active', l.created_at desc`;
  const [me] = await sql<{ standingSeat: string | null }[]>`select standing_seat from people where world_id = ${viewer.worldId} and id = ${viewer.personId}`;
  const canDecide = me?.standingSeat === "qa_director" || me?.standingSeat === "executive";
  const worked = records.filter((r) => r.runs > 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <WorldRealtime worldId={viewer.worldId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agents</h1>
          <p className="max-w-2xl text-sm text-muted">
            How each agent&apos;s work has fared with the people who decide, over the last 90 days of live incidents (drills, where AI-played seats approve, are left out). The Learning Loop turns repeated
            pushback into lessons; a lesson reaches an agent only after the QA Director or the Executive approves it.
          </p>
        </div>
        {canDecide && <RunLearning />}
      </div>

      <Panel title="Lessons">
        {lessons.length === 0 ? (
          <p className="text-sm text-muted">No lessons yet. The Learning Loop runs on Monday mornings when people have pushed back on agents at least twice.</p>
        ) : (
          <ul className="space-y-3">
            {lessons.map((l) => (
              <li key={l.id} className={cx("rounded border p-3 text-sm", l.status === "proposed" ? "border-at-risk" : "border-line")}>
                <p className="text-xs text-muted">
                  For {NAMES.get(l.agentId) ?? l.agentId} · <span className="capitalize">{l.status}</span>
                  {l.decidedBy ? ` by ${l.decidedBy}` : ""}
                  {l.decidedAt ? ` · ${timeLabel(l.decidedAt.toISOString())}` : ""}
                </p>
                <p className="mt-1 font-medium">{l.lesson}</p>
                <p className="mt-1 text-muted">{l.rationale}</p>
                {l.decisionReason && <p className="mt-1 text-xs text-muted">Reason: {l.decisionReason}</p>}
                {canDecide && (l.status === "proposed" || l.status === "active") && <DecideLesson lessonId={l.id} status={l.status} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Track records (live, last 90 days)">
        {worked.length === 0 ? (
          <p className="text-sm text-muted">No live agent work yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal">Agent</th>
                  <th className="py-1 font-normal">Runs</th>
                  <th className="py-1 font-normal">Proposals</th>
                  <th className="py-1 font-normal">Approved</th>
                  <th className="py-1 font-normal">Rejected / overridden</th>
                  <th className="py-1 font-normal">More evidence asked</th>
                  <th className="py-1 font-normal">Fabricated sources</th>
                  <th className="py-1 font-normal">Failed runs</th>
                  <th className="py-1 font-normal">Cost</th>
                  <th className="py-1 font-normal">Lessons</th>
                </tr>
              </thead>
              <tbody>
                {worked.map((r) => (
                  <tr key={r.agentId} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      {NAMES.get(r.agentId) ?? r.agentId}
                      <span className="block text-xs capitalize text-muted">{DEPARTMENTS.get(r.agentId)}</span>
                    </td>
                    <td className="font-mono text-xs">{r.runs}</td>
                    <td className="font-mono text-xs">
                      {r.proposals}
                      {r.pending > 0 && <span className="text-muted"> ({r.pending} open)</span>}
                    </td>
                    <td className="font-mono text-xs">
                      {r.approved}
                      {r.approvalRate !== null && <span className="text-muted"> ({Math.round(r.approvalRate * 100)}%)</span>}
                    </td>
                    <td className="font-mono text-xs">
                      {r.rejected} / {r.overridden}
                    </td>
                    <td className="font-mono text-xs">{r.moreEvidence}</td>
                    <td className={cx("font-mono text-xs", r.fabricatedSources > 0 && "font-semibold text-critical-text")}>{r.fabricatedSources}</td>
                    <td className="font-mono text-xs">{r.failedRuns}</td>
                    <td className="font-mono text-xs">${r.costUsd.toFixed(2)}</td>
                    <td className="font-mono text-xs">{r.activeLessons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
