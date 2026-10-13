/**
 * Reporting deadlines are arithmetic, so code computes them (CLAUDE.md principle 10); the
 * Regulator agents only name the rule. A world's clock is real time in live worlds and the
 * simulation clock in drills, so a drill's deadlines run at drill speed.
 */
import type { Sql, TransactionSql } from "@/db/client";

type Db = Sql | TransactionSql;

const HOUR_MS = 3_600_000;

export function dueAt(clockStartedAt: Date, deadlineHours: number): Date {
  return new Date(clockStartedAt.getTime() + deadlineHours * HOUR_MS);
}

/** Hours left until a deadline (negative once overdue), to one decimal. */
export function hoursLeft(due: Date, now: Date): number {
  return Math.round(((due.getTime() - now.getTime()) / HOUR_MS) * 10) / 10;
}

/** The current time in a world. */
export async function worldNow(db: Db, worldId: string): Promise<Date> {
  const [w] = await db<{ kind: string; simClock: Date | null }[]>`select kind, sim_clock from worlds where id = ${worldId}`;
  if (!w) throw new Error(`World ${worldId} not found`);
  return w.kind === "drill" && w.simClock ? w.simClock : new Date();
}

/**
 * When the company became aware of an incident, in the world's clock. Live: when it opened. A
 * drill's incident opens at tick 0, so awareness is the sim clock minus the hours played.
 */
export async function awarenessAt(db: Db, worldId: string, incidentId: string): Promise<Date> {
  const [row] = await db<{ kind: string; simClock: Date | null; openedAt: Date; tick: number | null }[]>`
    select w.kind, w.sim_clock, i.opened_at,
      (select d.tick from drill_runs d where d.world_id = i.world_id and d.incident_id = i.id) as tick
    from incidents i join worlds w on w.id = i.world_id
    where i.world_id = ${worldId} and i.id = ${incidentId}`;
  if (!row) throw new Error(`Incident ${incidentId} not found`);
  if (row.kind !== "drill" || !row.simClock) return row.openedAt;
  return new Date(row.simClock.getTime() - (row.tick ?? 0) * HOUR_MS);
}
