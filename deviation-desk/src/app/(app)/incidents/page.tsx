import Link from "next/link";
import { Mono, SeverityPill, timeLabel } from "@/components/ui";
import { listIncidents } from "@/incident-room/queries";
import { requireViewer } from "@/incident-room/viewer";

export default async function IncidentsPage() {
  const viewer = await requireViewer();
  const incidents = await listIncidents(viewer);
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="text-sm text-muted">Open incidents first. Pick one to take a seat.</p>
        </div>
        <Link href="/report" className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel">
          Report a problem
        </Link>
      </div>

      {incidents.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line bg-panel p-8 text-center">
          <p className="font-medium">No incidents right now.</p>
          <p className="mt-1 text-sm text-muted">If something has gone wrong, describe it and Intake Triage will help classify it.</p>
          <Link href="/report" className="mt-4 inline-block text-sm text-accent underline-offset-2 hover:underline">
            Report a problem
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-panel">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link href={`/incidents/${i.code}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-ground">
                <Mono>{i.code}</Mono>
                <span className="min-w-0 flex-1 font-medium">{i.title}</span>
                <SeverityPill severity={i.severity} />
                <span className="text-xs capitalize text-muted">{i.status}</span>
                {i.pendingDecisions > 0 && (
                  <span className="rounded-full bg-at-risk-fill px-2 py-0.5 text-xs text-at-risk-text">
                    {i.pendingDecisions} decision{i.pendingDecisions > 1 ? "s" : ""} waiting
                  </span>
                )}
                <time className="font-mono text-xs text-muted" dateTime={i.openedAt}>
                  {timeLabel(i.openedAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
