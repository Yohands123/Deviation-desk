import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DrillRealtime } from "@/components/drills/drill-bits";
import { Mono, Panel, cx } from "@/components/ui";
import { getDrillConsole, getDrillDebrief } from "@/drills/queries";
import { SEAT_LABELS } from "@/incident-room/types";
import { requireViewer } from "@/incident-room/viewer";
import type { SeatRole } from "@/agents/contract";
import { AskAuditor } from "./ask-auditor";

function Verdict({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={cx("inline-flex items-center gap-1.5", ok === null ? "text-muted" : ok ? "text-ok" : "text-critical-text")}>
      {ok !== null && <Icon aria-hidden className="size-4" />}
      {children}
    </span>
  );
}

function Tile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}

export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const d = await getDrillDebrief(viewer, id);
  if (!d) {
    const live = await getDrillConsole(viewer, id);
    if (live) redirect(`/drills/${id}`);
    notFound();
  }
  const { score, console: drill } = d;

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <DrillRealtime drillRunId={drill.id} worldId={drill.worldId} />
      <Link href="/drills" className="text-sm text-muted hover:text-ink">
        ← Drills
      </Link>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Debrief</p>
        <h1 className="text-2xl font-semibold">{drill.title}</h1>
        <p className="mt-1 text-sm text-muted">
          Ended at hour {drill.tick} of {drill.durationTicks} · seed <Mono>{drill.seed}</Mono> (start a drill with this seed to replay it) ·{" "}
          {drill.agentsEnabled ? "AI agents responded" : "people only"}
        </p>
      </div>

      <section aria-label="Scores" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Overall" value={`${score.overall} / 100`} />
        <Tile label="Root cause" value={score.rootCauseCorrect === null ? "Not proposed" : score.rootCauseCorrect ? "Found" : "Missed"}>
          <Verdict ok={score.rootCauseCorrect}>{score.rootCauseAccepted ? "Accepted by QA" : "Not accepted"}</Verdict>
        </Tile>
        <Tile label="Containment" value={score.ticksToContain === null ? "Not contained" : `Hour ${score.ticksToContain}`}>
          <Verdict ok={score.containedInTime}>Target: hour {drill.containWithinTicks}</Verdict>
        </Tile>
        <Tile label="True spread" value={`${score.spreadReached} ${score.spreadReached === 1 ? "object" : "objects"}`}>
          <Verdict ok={score.protectedAll}>{score.protectedAll ? "Protected objects stayed safe" : `Reached: ${score.unprotected.join(", ")}`}</Verdict>
        </Tile>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel title="The hidden truth">
            <p className="text-sm">{d.hiddenTruth.rootCause}</p>
            <p className="mt-1 text-xs text-muted">
              Cause: <Mono>{d.hiddenTruth.causeObject.code}</Mono> · accepted answers: {d.hiddenTruth.acceptableAnswers.join("; ")}
            </p>
          </Panel>

          <Panel title="Auditor review" action={<AskAuditor drillRunId={drill.id} requested={Boolean(d.auditRequestedAt)} hasReview={Boolean(d.review)} />}>
            {d.review ? (
              <div className="space-y-3 text-sm">
                <p>{d.review.summary}</p>
                {d.review.params && (
                  <>
                    <p>
                      <span className="text-muted">Team grade:</span> <span className="font-semibold">{d.review.params.teamGrade}</span>
                    </p>
                    <p>
                      <span className="text-muted">Root cause:</span> {d.review.params.rootCauseVerdict}
                    </p>
                    <ul className="space-y-1">
                      {d.review.params.seatGrades.map((g) => (
                        <li key={g.seat}>
                          <span className="font-medium">{SEAT_LABELS[g.seat as SeatRole] ?? g.seat}</span> <span className="font-mono">{g.grade}</span> <span className="text-muted">— {g.note}</span>
                        </li>
                      ))}
                    </ul>
                    <div>
                      <p className="font-medium">Top fixes</p>
                      <ol className="list-decimal pl-5">
                        {d.review.params.topFixes.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}
                <details>
                  <summary className="cursor-pointer text-muted">Reasoning</summary>
                  <p className="mt-1 whitespace-pre-wrap">{d.review.reasoning}</p>
                </details>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {d.auditRequestedAt ? "The Auditor is reviewing the drill. This page updates when the review lands." : "Ask the Auditor for a graded review of every seat and the team, with the top fixes."}
              </p>
            )}
          </Panel>

          <Panel title="What really happened">
            <ol className="space-y-2">
              {d.timeline.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-mono text-xs text-muted">Hour {e.tick}</span> <span className="font-medium">{e.actor}</span>
                  {e.hidden && <span className="text-xs text-muted"> (hidden during the drill)</span>}: <span className={e.reversed ? "line-through decoration-muted" : undefined}>{e.description}</span>
                  {e.reversed && <span className="text-xs text-ok"> reversed</span>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Decision speed by seat">
            {score.seats.length === 0 ? (
              <p className="text-sm text-muted">No proposals needed a decision.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-1 font-normal">Seat</th>
                    <th className="pb-1 font-normal">Decided</th>
                    <th className="pb-1 font-normal">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {score.seats.map((s) => (
                    <tr key={s.seat} className="border-t border-line">
                      <td className="py-1.5">
                        {SEAT_LABELS[s.seat as SeatRole] ?? s.seat}
                        {s.byAi && <span className="text-xs text-muted"> · AI-played</span>}
                      </td>
                      <td>
                        {s.decided}
                        {s.undecided > 0 && <span className="text-critical-text"> (+{s.undecided} open)</span>}
                      </td>
                      <td className="font-mono">{s.averageTicks === null ? "–" : `${s.averageTicks} h`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Integrity">
            <p className="text-sm">
              <Verdict ok={score.fabricatedSources === 0}>{score.fabricatedSources === 0 ? "No fabricated sources" : `${score.fabricatedSources} fabricated sources`}</Verdict>
            </p>
            <p className="mt-1 text-sm text-muted">Agent cost: ${score.costUsd.toFixed(3)}</p>
          </Panel>
        </div>
      </div>
    </main>
  );
}
