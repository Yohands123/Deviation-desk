import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DrillRealtime, ModeBadge } from "@/components/drills/drill-bits";
import { Panel, timeLabel } from "@/components/ui";
import { getDrillConsole } from "@/drills/queries";
import { requireViewer } from "@/incident-room/viewer";
import { DrillControls } from "./controls";

export default async function DrillConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const drill = await getDrillConsole(viewer, id);
  if (!drill) notFound();
  if (drill.status === "ended") redirect(`/drills/${drill.id}/debrief`);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <DrillRealtime drillRunId={drill.id} worldId={drill.worldId} />
      <Link href="/drills" className="text-sm text-muted hover:text-ink">
        ← Drills
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{drill.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{drill.description}</p>
        </div>
        {drill.incidentCode && (
          <Link href={`/drills/${drill.id}/room`} className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel">
            Enter the drill incident room
          </Link>
        )}
      </div>

      <section aria-label="Drill clock" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
        <span className="font-mono text-lg">
          Hour {drill.tick} <span className="text-muted">of {drill.durationTicks}</span>
        </span>
        <span className="font-mono text-muted">Sim time {timeLabel(drill.simClock)}</span>
        <span className="capitalize">{drill.status}</span>
        <span className="inline-flex items-center gap-2">
          Saboteurs <ModeBadge mode={drill.mode} />
        </span>
        <span className="text-muted">Contain within {drill.containWithinTicks} hours</span>
        <span className="text-muted">{drill.agentsEnabled ? "AI agents respond" : "People only (agents off)"}</span>
        <span className="font-mono text-xs text-muted">Seed {drill.seed}</span>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {drill.isFacilitator ? (
            <Panel title="Facilitator controls">
              <DrillControls drill={drill} />
            </Panel>
          ) : (
            <Panel title="Facilitator">
              <p className="text-sm">{drill.facilitator ?? "Someone"} is running this drill. Enter the incident room to take a seat.</p>
            </Panel>
          )}
          <Panel title="What has happened">
            {drill.effects.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. The clock starts when the facilitator presses Play or Step.</p>
            ) : (
              <ol className="space-y-2">
                {drill.effects.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-mono text-xs text-muted">Hour {e.tick}</span> <span className="text-muted">· {e.actor}{e.hidden ? " (hidden from players)" : ""}:</span>{" "}
                    <span className={e.reversed ? "line-through decoration-muted" : undefined}>{e.description}</span>
                    {e.reversed && <span className="text-xs text-ok"> reversed</span>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Saboteurs" action={<ModeBadge mode={drill.mode} />}>
            <ul className="space-y-3">
              {drill.saboteurs.map((s) => (
                <li key={s.name} className="text-sm">
                  <p className="font-medium">{s.label}</p>
                  <p className="text-muted">{s.behaviour}</p>
                  {s.lastAction && <p className="mt-0.5 text-xs">{s.lastAction}</p>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Scatter: quiet. Chase: active. Frightened: after a team milestone they hold off and recent moves can be reversed.</p>
          </Panel>
          {drill.trueSpread !== null && (
            <Panel title="True spread · facilitator only">
              <p className="text-sm">
                The real contamination has reached <span className="font-mono">{drill.trueSpread}</span> {drill.trueSpread === 1 ? "object" : "objects"}. Players learn this at the debrief.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}
