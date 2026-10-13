import { AiMarker, cx, Mono, Panel, timeLabel } from "@/components/ui";
import { WorldRealtime } from "@/components/world-realtime";
import { getStrategyPage, type AgentNote, type ProposalView } from "@/expansion/queries";
import { requireViewer } from "@/incident-room/viewer";
import { AskLaunchPlanner, DecideProposal, RunReview, SimulateAgain } from "./strategy-client";

const KIND_LABEL: Record<string, string> = {
  fill_line: "New fill line",
  test_capacity: "Test capacity",
  qa_capacity: "QA capacity",
  backup_supplier: "Backup supplier",
  distribution_center: "Distribution center",
};
const AGENT_LABEL: Record<string, string> = {
  capacity_planner: "Capacity Planner",
  network_planner: "Network Planner",
  supplier_scout: "Supplier Scout",
  expansion_lead: "Expansion Lead",
  readiness_checker: "Readiness Checker",
  launch_planner: "Launch Planner",
};
const usd = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
const EFFECT = { better: "text-ok", worse: "text-critical-text", same: "text-muted" } as const;

function Note({ note }: { note: AgentNote }) {
  return (
    <div className="rounded-md bg-ai-tint p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AiMarker label={AGENT_LABEL[note.agentId] ?? note.agentId} />
        <time className="font-mono text-[11px] text-muted" dateTime={note.at}>
          {timeLabel(note.at)}
        </time>
      </div>
      <p className="mt-1">{note.summary}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted">Reasoning</summary>
        <p className="mt-1 whitespace-pre-wrap">{note.reasoning}</p>
      </details>
    </div>
  );
}

function ChangeDetails({ change }: { change: Record<string, unknown> }) {
  const entries = Object.entries(change).filter(([k]) => k !== "kind");
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
          <dd className="font-mono">{Array.isArray(v) ? v.map((x) => (typeof x === "object" && x ? Object.values(x).join(" · ") : String(x))).join("; ") : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Proposal({ p, seat }: { p: ProposalView; seat: string | null }) {
  const decidedBy = (s: string) => p.decisions.some((d) => d.seat === s);
  const canDecide =
    p.status === "proposed" &&
    ((seat === "strategy_growth" && !decidedBy("strategy_growth")) || (seat === "executive" && p.needsExecutive && !decidedBy("executive")));
  const verdict = p.readiness?.params.verdict;
  const gaps = Array.isArray(p.readiness?.params.gaps) ? (p.readiness.params.gaps as string[]) : [];
  return (
    <article className={cx("rounded-lg border bg-panel p-4", p.status === "proposed" ? "border-line" : "border-line opacity-90")} aria-label={`${p.code}: ${p.title}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mono>{p.code}</Mono>
        <h3 className="min-w-0 flex-1 font-semibold">{p.title}</h3>
        <span className="rounded bg-ground px-2 py-0.5 text-xs">{KIND_LABEL[p.kind] ?? p.kind}</span>
        <span className={cx("text-xs font-medium capitalize", p.status === "approved" ? "text-ok" : p.status === "rejected" ? "text-critical-text" : "text-at-risk-text")}>{p.status}</span>
      </div>
      <p className="mt-1 text-sm">{p.summary}</p>
      <p className="mt-1 text-xs text-muted">
        Proposed by {AGENT_LABEL[p.proposedBy] ?? p.proposedBy} · {usd(p.estimatedCostUsd)} · {p.leadTimeMonths} months to put in place
        {p.needsExecutive ? " · needs the Executive as well" : ""}
      </p>
      <div className="mt-2">
        <ChangeDetails change={p.change} />
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Simulate before you build</h4>
          <SimulateAgain proposalId={p.id} />
        </div>
        {p.simulation ? (
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-normal">Stress test</th>
                <th className="py-1 font-normal">Today</th>
                <th className="py-1 font-normal">With the change</th>
                <th className="py-1 font-normal">Effect</th>
              </tr>
            </thead>
            <tbody>
              {p.simulation.rows.map((r) => (
                <tr key={r.measure} className="border-t border-line">
                  <td className="py-1 pr-2">{r.measure}</td>
                  <td className="py-1 pr-2 font-mono text-xs">{r.baseline}</td>
                  <td className="py-1 pr-2 font-mono text-xs">{r.withChange}</td>
                  <td className={cx("py-1 text-xs", EFFECT[r.effect])}>{r.effect === "same" ? "No change" : r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-1 text-sm text-muted">Not simulated yet.</p>
        )}
        {p.simulation && <p className="mt-1 text-xs text-muted">Simulated {timeLabel(p.simulation.at)} on copies of the company; nothing changed in the live twin.</p>}
      </div>

      {p.readiness && (
        <div className="mt-3 rounded-md bg-ai-tint p-3 text-sm">
          <AiMarker label={`Readiness Checker · ${verdict === "ready" ? "ready to decide" : "not yet"}`} />
          <p className="mt-1">{p.readiness.summary}</p>
          {gaps.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {p.decisions.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {p.decisions.map((d) => (
            <li key={`${d.seat}-${d.at}`}>
              <span className={d.outcome === "approved" ? "text-ok" : "text-critical-text"}>{d.outcome === "approved" ? "Approved" : "Rejected"}</span> by {d.by} (
              {d.seat === "executive" ? "Executive" : "Strategy & Growth"}){d.reason ? `: ${d.reason}` : ""} <span className="font-mono text-xs text-muted">{timeLabel(d.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {canDecide && (
        <div className="mt-3 border-t border-line pt-3">
          <DecideProposal proposalId={p.id} label={seat === "executive" ? "Your decision as Executive (spend)" : "Your decision as Strategy & Growth"} />
        </div>
      )}
    </article>
  );
}

export default async function StrategyPage() {
  const viewer = await requireViewer();
  const page = await getStrategyPage(viewer);
  const deciders = page.standingSeat === "strategy_growth" || page.standingSeat === "executive";
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <WorldRealtime worldId={viewer.worldId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Strategy & Growth</h1>
          <p className="max-w-2xl text-sm text-muted">
            Each week the planners look for capacity, network and supplier risks and draft proposals. Every proposal is priced in code and simulated on copies of the company before anyone decides.
            Strategy & Growth decides; spend of {usd(page.spendThresholdUsd)} or more also needs the Executive.
          </p>
        </div>
        {deciders && <RunReview />}
      </div>

      {page.ranking && (
        <Panel title="Expansion Lead's ranking">
          <Note note={page.ranking} />
        </Panel>
      )}

      <section aria-label="Proposals" className="space-y-3">
        <h2 className="text-lg font-semibold">Proposals</h2>
        {page.proposals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-panel p-6 text-sm text-muted">No proposals yet. The weekly review runs on Monday mornings{deciders ? ", or run it now" : ""}.</p>
        ) : (
          page.proposals.map((p) => <Proposal key={p.id} p={p} seat={page.standingSeat} />)
        )}
      </section>

      {page.reviewNotes.length > 0 && (
        <Panel title="From the latest review">
          <div className="space-y-2">
            {page.reviewNotes.map((n) => (
              <Note key={n.decisionRecordId} note={n} />
            ))}
          </div>
        </Panel>
      )}

      <Panel title="What would a launch take?">
        <AskLaunchPlanner />
        {page.launchNotes.length > 0 && (
          <div className="mt-3 space-y-2">
            {page.launchNotes.slice(0, 3).map((n) => (
              <Note key={n.decisionRecordId} note={n} />
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
