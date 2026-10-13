/**
 * Temperature excursions: when a shipment's readings left its storage range, for how long, and how
 * far. Plain arithmetic so no agent ever estimates a duration itself (CLAUDE.md principle 10).
 */
import { STORAGE_RANGES, type StorageCondition } from "./watchers";

export interface TempReading {
  id: string;
  value: number;
  recordedAt: Date;
}

export interface Excursion {
  start: Date;
  /** First reading back in range, or the last reading if it never came back. */
  end: Date;
  durationHours: number;
  /** The reading furthest outside the range, in °C. */
  peak: number;
  ongoing: boolean;
  readingIds: string[];
}

export function findExcursions(readings: TempReading[], condition: StorageCondition): Excursion[] {
  const range = STORAGE_RANGES[condition];
  const outside = (v: number) => v < range.minC || v > range.maxC;
  const distance = (v: number) => (v > range.maxC ? v - range.maxC : range.minC - v);
  const sorted = [...readings].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const excursions: Excursion[] = [];
  let current: { start: Date; peak: number; ids: string[] } | null = null;
  for (const r of sorted) {
    if (outside(r.value)) {
      if (!current) current = { start: r.recordedAt, peak: r.value, ids: [] };
      if (distance(r.value) > distance(current.peak)) current.peak = r.value;
      current.ids.push(r.id);
    } else if (current) {
      excursions.push(close(current, r.recordedAt, false));
      current = null;
    }
  }
  const last = sorted.at(-1);
  if (current && last) excursions.push(close(current, last.recordedAt, true));
  return excursions;
}

function close(c: { start: Date; peak: number; ids: string[] }, end: Date, ongoing: boolean): Excursion {
  const hours = (end.getTime() - c.start.getTime()) / 3_600_000;
  return { start: c.start, end, durationHours: Math.round(hours * 100) / 100, peak: c.peak, ongoing, readingIds: c.ids };
}
