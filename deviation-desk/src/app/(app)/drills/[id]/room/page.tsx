import Link from "next/link";
import { notFound } from "next/navigation";
import { DrillRealtime, ModeBadge } from "@/components/drills/drill-bits";
import { IncidentRoomScreen } from "@/components/incident-room/incident-room-screen";
import { getDrillConsole } from "@/drills/queries";
import { getIncidentRoom } from "@/incident-room/queries";
import { LIVE_SEATS } from "@/incident-room/types";
import { requireViewer, requireViewerIn } from "@/incident-room/viewer";

export default async function DrillRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seat?: string }>;
}) {
  const { id } = await params;
  const { seat } = await searchParams;
  const drill = await getDrillConsole(await requireViewer(), id);
  if (!drill?.incidentCode) notFound();
  // Inside the drill world: same person, isolated copy of the company.
  const viewer = await requireViewerIn(drill.worldId);
  const room = await getIncidentRoom(viewer, drill.incidentCode, [...LIVE_SEATS, "facilitator"]);
  if (!room) notFound();
  room.scene.saboteurs = drill.saboteurs.map((s) => ({ name: s.name, label: s.label, mode: s.mode, roomId: s.roomId }));

  const banner = (
    <div className="border-t border-line">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-sm">
        <span className="font-mono">
          Drill hour {drill.tick} <span className="text-muted">of {drill.durationTicks}</span>
        </span>
        <span className="capitalize text-muted">{drill.status}</span>
        <span className="inline-flex items-center gap-2">
          Saboteurs <ModeBadge mode={drill.mode} />
        </span>
        <span className="text-muted">{drill.agentsEnabled ? "AI agents respond" : "People only"}</span>
        <Link href={`/drills/${drill.id}`} className="ml-auto text-accent hover:underline">
          Drill console
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <DrillRealtime drillRunId={drill.id} worldId={drill.worldId} />
      <IncidentRoomScreen
        viewer={viewer}
        room={room}
        world={drill.worldId}
        roomPath={`/drills/${drill.id}/room`}
        back={{ href: `/drills/${drill.id}`, label: "Drill console" }}
        seatChoose={seat === "choose"}
        banner={banner}
        auditorNote="The Auditor grades every seat and the team once the drill ends, on the debrief page."
      />
    </>
  );
}
