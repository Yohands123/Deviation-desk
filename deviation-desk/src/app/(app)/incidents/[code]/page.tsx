import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentCard } from "@/components/incident-room/agent-card";
import { DecisionBoard } from "@/components/incident-room/decision-board";
import { DecisionCard } from "@/components/incident-room/decision-card";
import { EvidencePanel } from "@/components/incident-room/evidence-panel";
import { FlatMap } from "@/components/incident-room/flat-map";
import { LiveFeed } from "@/components/incident-room/live-feed";
import { RealtimeRefresh } from "@/components/incident-room/realtime-refresh";
import { SeatPicker } from "@/components/incident-room/seat-picker";
import { PeopleInRoom, YourSeat } from "@/components/incident-room/seats-panel";
import { SourceDrawerProvider } from "@/components/incident-room/source-drawer";
import { SiteView } from "@/components/voxel/site-view";
import { AiMarker, Mono, Panel, SeverityPill, timeLabel } from "@/components/ui";
import { getIncidentRoom } from "@/incident-room/queries";
import { requireViewer } from "@/incident-room/viewer";

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ seat?: string; engine?: string }>;
}) {
  const viewer = await requireViewer();
  const { code } = await params;
  const { seat, engine } = await searchParams;
  const room = await getIncidentRoom(viewer, decodeURIComponent(code));
  if (!room) notFound();
  const { incident } = room;

  const header = (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/incidents" className="text-sm text-muted hover:text-ink">
          ← Incidents
        </Link>
        <Mono>{incident.code}</Mono>
        {/* Own line on phones; shares the row on wider screens. */}
        <h1 className="order-last w-full text-lg font-semibold sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">{incident.title}</h1>
        <SeverityPill severity={incident.severity} />
        <span className="text-xs capitalize text-muted">{incident.status}</span>
        <span className="font-mono text-xs text-muted">Opened {timeLabel(incident.openedAt)}</span>
        <RealtimeRefresh incidentId={incident.id} />
      </div>
    </header>
  );

  if (!room.mySeat || seat === "choose") {
    return (
      <>
        {header}
        <main className="mx-auto max-w-[1440px] px-4 py-6">
          <h2 className="text-xl font-semibold">Choose your seat</h2>
          <p className="mb-5 mt-1 text-sm text-muted">Each seat sees the same incident through its own lens and owns its own decisions. Empty seats are played by AI.</p>
          <SeatPicker code={incident.code} seats={room.seats} viewerPersonId={viewer.personId} />
        </main>
      </>
    );
  }

  const findings = [...room.cards].reverse();
  return (
    <SourceDrawerProvider>
      {header}
      {engine === "down" && (
        <p className="border-b border-at-risk bg-at-risk-fill px-4 py-2 text-sm text-at-risk-text">
          The incident is open, but the workflow engine is not running, so agents have not started. Start it with <span className="font-mono">npm run inngest</span>.
        </p>
      )}
      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)_380px]">
        {/* Left: your seat, people, live feed */}
        <div className="space-y-4">
          <Panel title="Your seat">
            <YourSeat code={incident.code} mySeat={room.mySeat} seats={room.seats} />
          </Panel>
          <Panel title="People in the room">
            <PeopleInRoom seats={room.seats} />
          </Panel>
          <Panel title="Live feed">
            <LiveFeed items={room.feed} />
          </Panel>
        </div>

        {/* Center: the site, spread, findings, evidence */}
        <div className="min-w-0 space-y-4">
          <Panel title="Site">
            <SiteView scene={room.scene} cards={room.cards} flat={<FlatMap rooms={room.map} />} />
            {room.objects.length > 0 && (
              <p className="mt-3 text-sm">
                <span className="text-muted">Opened for: </span>
                <Mono>{room.objects.map((o) => o.code).join(", ")}</Mono>
              </p>
            )}
          </Panel>
          {room.spreadPaths.length > 0 && (
            <Panel title="Spread paths">
              <p className="mb-2 text-xs text-muted">How the incident objects connect to other batches and shipments (shared equipment, shared lots, stock).</p>
              <ul className="space-y-1 font-mono text-[13px]">
                {room.spreadPaths.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Agent findings" action={<AiMarker label={`${findings.length} records`} />}>
            {findings.length === 0 ? (
              <p className="text-sm text-muted">Agents have not reported yet.</p>
            ) : (
              <div className="space-y-3">
                {findings.map((c) => (
                  <AgentCard key={c.decisionRecordId} card={c} />
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Evidence">
            <EvidencePanel code={incident.code} items={room.evidence} />
          </Panel>
        </div>

        {/* Right: decisions needing you, Decision Board, Auditor. First on phones: decisions come first. */}
        <div className="order-first space-y-4 lg:order-none">
          {room.pendingForMe.length > 0 ? (
            room.pendingForMe.map((c) => <DecisionCard key={c.decisionRecordId} code={incident.code} card={c} />)
          ) : (
            <section className="rounded-lg border-2 border-line bg-panel p-4" aria-label="Decisions">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Decision needed</p>
              <p className="mt-1 text-sm">Nothing is waiting for your seat right now.</p>
            </section>
          )}
          <Panel title="Decision Board">
            <DecisionBoard code={incident.code} conflicts={room.conflicts} mySeat={room.mySeat} />
          </Panel>
          <section className="rounded-lg border border-line bg-auditor-bg p-4" aria-label="Auditor">
            <h2 className="text-sm font-semibold text-auditor">Auditor</h2>
            <p className="mt-1 text-sm text-muted">The Auditor reviews skipped steps and unowned tasks once it joins in Phase 7.</p>
          </section>
        </div>
      </main>
    </SourceDrawerProvider>
  );
}
