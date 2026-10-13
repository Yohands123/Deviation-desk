/**
 * Seats on an incident (CLAUDE.md §10): who holds each role. A null person means the seat is
 * played by AI, which may approve only in drill worlds.
 */
import type { Sql } from "@/db/client";
import type { SeatRole } from "@/agents/contract";

export interface SeatAssignment {
  worldId: string;
  companyId: string;
  incidentId: string;
  role: SeatRole;
  personId: string | null;
}

export async function takeSeat(sql: Sql, seat: SeatAssignment): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into seats ${tx(seat)}
      on conflict (world_id, incident_id, role) do update set person_id = excluded.person_id`;
    await tx`insert into incident_events ${tx({
      worldId: seat.worldId,
      companyId: seat.companyId,
      incidentId: seat.incidentId,
      actorType: seat.personId ? "human" : "system",
      actorId: seat.personId ?? "ai",
      seat: seat.role,
      eventType: "seat_taken",
      payload: tx.json({ role: seat.role, personId: seat.personId }),
    })}`;
  });
}

export async function seatHolder(
  sql: Sql,
  worldId: string,
  incidentId: string,
  role: SeatRole,
): Promise<{ personId: string | null } | null> {
  const [row] = await sql<{ personId: string | null }[]>`
    select person_id from seats where world_id = ${worldId} and incident_id = ${incidentId} and role = ${role}`;
  return row ?? null;
}
