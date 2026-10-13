import "server-only";
import type { Sql } from "@/db/client";

export type RoomsOf = (table: string, id: string) => string[];

/**
 * Which rooms hold, or handled, a cited or connected row: equipment and production lines by their
 * room, batches by their line's room, stock by the storage rooms, shipments by the shipping room,
 * and records and sensor readings by the object they are about.
 */
export async function roomLookup(sql: Sql, worldId: string): Promise<RoomsOf> {
  const equipment = await sql<{ id: string; roomId: string }[]>`select id, room_id from equipment where world_id = ${worldId}`;
  const batches = await sql<{ id: string; roomId: string }[]>`
    select b.id, pl.room_id from batches b join production_lines pl on pl.world_id = b.world_id and pl.id = b.line_id
    where b.world_id = ${worldId}`;
  const lines = await sql<{ id: string; roomId: string }[]>`select id, room_id from production_lines where world_id = ${worldId}`;
  const rooms = await sql<{ id: string; roomType: string }[]>`select id, room_type from rooms where world_id = ${worldId}`;
  const subjects = await sql<{ id: string; subjectTable: string | null; subjectId: string | null }[]>`
    select id::text as id, subject_table, subject_id::text as subject_id from records where world_id = ${worldId} and subject_id is not null
    union all
    select id::text, subject_table, subject_id::text from sensor_readings where world_id = ${worldId}`;

  const storage = rooms.filter((r) => r.roomType === "storage").map((r) => r.id);
  const shipping = rooms.filter((r) => r.roomType === "shipping").map((r) => r.id);
  const direct: Record<string, Map<string, string[]>> = {
    rooms: new Map(rooms.map((r) => [r.id, [r.id]])),
    equipment: new Map(equipment.map((e) => [e.id, [e.roomId]])),
    batches: new Map(batches.map((b) => [b.id, [b.roomId]])),
    production_lines: new Map(lines.map((l) => [l.id, [l.roomId]])),
  };
  const about = new Map(subjects.map((s) => [s.id, s]));

  const roomsOf: RoomsOf = (table, id) => {
    if (table === "inventory_lots") return storage;
    if (table === "shipments") return shipping;
    if (table === "records" || table === "sensor_readings") {
      const s = about.get(id);
      return s?.subjectTable && s.subjectId && s.subjectTable !== table ? roomsOf(s.subjectTable, s.subjectId) : [];
    }
    return direct[table]?.get(id) ?? [];
  };
  return roomsOf;
}
