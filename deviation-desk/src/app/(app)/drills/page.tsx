import Link from "next/link";
import { Panel, timeLabel } from "@/components/ui";
import { listDrills, listScenarios } from "@/drills/queries";
import { requireViewer } from "@/incident-room/viewer";
import { StartDrillForm } from "./start-drill-form";

const STATUS: Record<string, string> = { running: "Running", paused: "Paused", ended: "Ended" };

export default async function DrillsPage() {
  const viewer = await requireViewer();
  const [drills, scenarios] = await Promise.all([listDrills(viewer), listScenarios(viewer)]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Drills</h1>
        <p className="text-sm text-muted">
          Practise on an isolated copy of the company. Nothing in a drill touches live data; saboteurs make it hard, and the debrief shows what really happened.
        </p>
      </div>

      <Panel title="Start a drill" action={<Link href="/drills/new" className="text-sm text-accent hover:underline">Describe your own scenario</Link>}>
        {scenarios.length === 0 ? (
          <p className="text-sm text-muted">No approved scenarios yet. Describe one and approve its preview to add it here.</p>
        ) : (
          <StartDrillForm scenarios={scenarios} />
        )}
      </Panel>

      <Panel title="Drills">
        {drills.length === 0 ? (
          <p className="text-sm text-muted">No drills yet. Start one above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {drills.map((d) => (
              <li key={d.id}>
                <Link href={d.status === "ended" ? `/drills/${d.id}/debrief` : `/drills/${d.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-ground">
                  <span className="min-w-0 flex-1 font-medium">{d.title}</span>
                  <span className="text-xs text-muted">{STATUS[d.status]}</span>
                  <span className="font-mono text-xs text-muted">
                    Hour {d.tick} of {d.durationTicks}
                  </span>
                  {d.overall !== null && <span className="rounded bg-ground px-2 py-0.5 text-xs">Score {d.overall}</span>}
                  <span className="text-xs text-muted">{d.facilitator ? `Facilitator: ${d.facilitator}` : ""}</span>
                  <time className="font-mono text-xs text-muted" dateTime={d.startedAt}>
                    {timeLabel(d.startedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
