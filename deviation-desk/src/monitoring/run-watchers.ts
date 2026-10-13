/**
 * Layer 1: scans new sensor readings in live worlds and emits events for the agent chain
 * (CLAUDE.md §8). No AI. Each world's scan writes a heartbeat so a silent watcher can be noticed.
 * Drill worlds are driven by the simulation instead.
 */
import type { Sql } from "@/db/client";
import type { Emitted } from "@/workflows/events";
import { checkReading, STORAGE_RANGES, type StorageCondition } from "./watchers";

/** On a world's first scan, look back this far. */
const FIRST_SCAN_LOOKBACK_MS = 60 * 60 * 1000;
const MAX_EVENTS_PER_WORLD = 20;

interface ReadingRow {
  worldId: string;
  companyId: string;
  subjectTable: "rooms" | "equipment" | "shipments";
  subjectId: string;
  metric: string;
  value: string;
  recordedAt: Date;
  storageCondition: StorageCondition | null;
}

export async function runReadingWatchers(sql: Sql, now = new Date()): Promise<Emitted[]> {
  const worlds = await sql<{ id: string }[]>`select id from worlds where kind = 'live' and status = 'active'`;
  const events: Emitted[] = [];
  for (const world of worlds) {
    const watcherId = `readings:${world.id}`;
    const [beat] = await sql<{ lastSeenAt: Date }[]>`select last_seen_at from watcher_heartbeats where watcher_id = ${watcherId}`;
    const since = beat?.lastSeenAt ?? new Date(now.getTime() - FIRST_SCAN_LOOKBACK_MS);

    const readings = await sql<ReadingRow[]>`
      select r.world_id, r.company_id, r.subject_table, r.subject_id, r.metric, r.value, r.recorded_at, s.storage_condition
      from sensor_readings r
      left join shipments s on r.subject_table = 'shipments' and s.world_id = r.world_id and s.id = r.subject_id
      where r.world_id = ${world.id} and r.recorded_at > ${since} and r.recorded_at <= ${now}
      order by r.recorded_at`;

    // One event per subject and metric (its latest out-of-rule reading), so a burst of readings
    // wakes an agent once.
    const latest = new Map<string, Emitted>();
    for (const r of readings) {
      const range = r.storageCondition ? STORAGE_RANGES[r.storageCondition] : undefined;
      const hit = checkReading({ ...r, value: Number(r.value) }, range);
      if (!hit) continue;
      const { range: _range, ...data } = hit.data;
      latest.set(`${r.subjectId}:${r.metric}`, {
        name: hit.name,
        data: { ...data, companyId: r.companyId, recordedAt: r.recordedAt.toISOString() },
      });
    }
    events.push(...[...latest.values()].slice(0, MAX_EVENTS_PER_WORLD));

    await sql`
      insert into watcher_heartbeats (watcher_id, last_seen_at) values (${watcherId}, ${now})
      on conflict (watcher_id) do update set last_seen_at = excluded.last_seen_at`;
  }
  return events;
}
