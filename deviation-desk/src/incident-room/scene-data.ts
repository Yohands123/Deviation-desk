/**
 * Scene data for the voxel world, built from the twin and the incident room view.
 */
import "server-only";
import type { SeatRole } from "@/agents/contract";
import { defaultAgents } from "@/agents/registry";
import type { Sql } from "@/db/client";
import { AGENT_HOME, AGENT_OUTFIT, firstRoom, roomsMatching, SEAT_HOME, SEAT_OUTFIT } from "@/voxel/roles";
import type { SceneData, SceneRoom, SceneWorker } from "@/voxel/types";
import type { RoomsOf } from "./room-lookup";
import { SEAT_LABELS, type AgentCard, type MapRoom, type SeatView } from "./types";
import { isOpen } from "./view-model";

/** Work this recent is shown as a worker walking to the room. */
const WALKING_WINDOW_MS = 3 * 60 * 1000;
const AGENTS = new Map(defaultAgents.map((a) => [a.id, a]));

function mostCommon(ids: string[]): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function buildSceneData(
  sql: Sql,
  worldId: string,
  view: { map: MapRoom[]; cards: AgentCard[]; seats: SeatView[]; mySeat: SeatRole | null },
  roomsOf: RoomsOf,
  now = new Date(),
): Promise<SceneData> {
  const roomRows = await sql<{ id: string; roomType: string; status: string }[]>`select id, room_type, status from rooms where world_id = ${worldId}`;
  const types = new Map(roomRows.map((r) => [r.id, r]));

  // Tape where held or quarantined material sits: held stock in storage, recently made
  // quarantined batches in their production room, and any locked room.
  const [heldStock] = await sql<{ n: number }[]>`select count(*)::int as n from inventory_lots where world_id = ${worldId} and on_hold`;
  const quarantinedRooms = await sql<{ roomId: string }[]>`
    select distinct pl.room_id from batches b join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
    where b.world_id = ${worldId} and b.status = 'quarantined' and b.produced_at > now() - interval '30 days'`;
  const tapedProduction = new Set(quarantinedRooms.map((r) => r.roomId));

  const rooms: SceneRoom[] = view.map.map((m) => {
    const row = types.get(m.id);
    const roomType = row?.roomType ?? "other";
    const taped = row?.status === "locked" || tapedProduction.has(m.id) || (roomType === "storage" && (heldStock?.n ?? 0) > 0);
    return { id: m.id, name: m.name, department: m.department, roomType, x: m.x, y: m.y, w: m.w, d: m.d, tint: m.tint, reasons: m.reasons, taped };
  });

  const equipment = await sql<Array<{ id: string; name: string; type: string; roomId: string; status: string; lineStatus: string | null }>>`
    select e.id, e.name, e.equipment_type as type, e.room_id, e.status, pl.status as line_status
    from equipment e left join production_lines pl on pl.world_id = e.world_id and pl.id = e.line_id
    where e.world_id = ${worldId} order by e.name`;

  const trucks = await sql<Array<{ shipmentCode: string; status: string; destination: string }>>`
    select s.shipment_code, s.status, coalesce(d.name, 'unknown') as destination
    from shipments s
    left join locations o on o.world_id = s.world_id and o.id = s.origin_id
    left join locations d on d.world_id = s.world_id and d.id = s.destination_id
    where s.world_id = ${worldId} and (s.status = 'at_dock' or (s.status = 'held' and o.kind = 'dock'))
    order by s.status = 'held' desc, s.shipment_code`;

  const sceneRooms = rooms.map((r) => ({ id: r.id, department: r.department, roomType: r.roomType }));
  const criticalRoom = rooms.find((r) => r.tint === "critical")?.id ?? null;

  // Agents: one worker each, at the room their latest work is about.
  const latest = new Map<string, AgentCard>();
  for (const c of view.cards) latest.set(c.agentId, c);
  const agentWorkers: SceneWorker[] = [...latest.values()].flatMap((card) => {
    const config = AGENTS.get(card.agentId);
    if (!config) return [];
    const home = firstRoom(sceneRooms, AGENT_HOME[config.department]);
    if (!home) return [];
    const cited = card.sources.flatMap((s) => roomsOf(s.table, s.rowId)).filter((id) => types.has(id));
    const target = mostCommon(cited) ?? (["investigation", "containment"].includes(config.department) ? criticalRoom : null) ?? home;
    return [
      {
        id: `agent:${card.agentId}`,
        kind: "agent" as const,
        name: config.name,
        role: config.job,
        outfit: AGENT_OUTFIT[config.department],
        homeRoomId: home,
        targetRoomId: target,
        walking: now.getTime() - new Date(card.createdAt).getTime() < WALKING_WINDOW_MS,
        carryingFolder: view.cards.some((c) => c.agentId === card.agentId && c.requiresApproval && isOpen(c)),
        decisionRecordId: card.decisionRecordId,
      },
    ];
  });

  // People: in their seat's department.
  const peopleWorkers: SceneWorker[] = view.seats.flatMap((s) => {
    if (!s.holder) return [];
    const room = firstRoom(sceneRooms, SEAT_HOME[s.role] ?? { department: "Quality Assurance" });
    if (!room) return [];
    return [
      {
        id: `person:${s.holder.personId}`,
        kind: "person" as const,
        name: s.holder.name,
        role: SEAT_LABELS[s.role],
        outfit: SEAT_OUTFIT[s.role],
        homeRoomId: room,
        targetRoomId: room,
        walking: false,
        carryingFolder: false,
        decisionRecordId: null,
      },
    ];
  });

  return {
    rooms,
    equipment: equipment.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      roomId: e.roomId,
      status: e.status,
      halted: ["halted", "failed"].includes(e.status) || e.lineStatus === "halted",
    })),
    trucks: trucks.map((t) => ({ ...t, held: t.status === "held" })),
    workers: [...agentWorkers, ...peopleWorkers],
    focusRoomIds: view.mySeat ? roomsMatching(sceneRooms, SEAT_HOME[view.mySeat]) : [],
  };
}
