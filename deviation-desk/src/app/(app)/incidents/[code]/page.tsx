import { notFound } from "next/navigation";
import { IncidentRoomScreen } from "@/components/incident-room/incident-room-screen";
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
  return (
    <IncidentRoomScreen
      viewer={viewer}
      room={room}
      world={null}
      roomPath={`/incidents/${room.incident.code}`}
      back={{ href: "/incidents", label: "Incidents" }}
      seatChoose={seat === "choose"}
      engineDown={engine === "down"}
      auditorNote="The Auditor checks open incidents every hour for unowned or overdue work and reporting deadlines, and grades the response when the incident closes."
    />
  );
}
