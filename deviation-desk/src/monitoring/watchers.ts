/**
 * Layer 1 monitoring: plain rules, no AI (CLAUDE.md §8). Cheap, constant, deterministic.
 * Each watcher returns events to emit and must write a heartbeat each run.
 */
export interface Reading {
  worldId: string;
  subjectTable: "rooms" | "equipment" | "shipments";
  subjectId: string;
  metric: string;
  value: number;
  recordedAt: Date;
}

export interface WatcherEvent {
  name: "sensor/anomaly" | "shipment/temp_excursion";
  data: Record<string, unknown>;
}

/** Thresholds are configuration, per customer. These are demo defaults. */
export const THRESHOLDS: Record<string, { alert: number; action: number }> = {
  em_cfu: { alert: 1, action: 3 },
};

export type StorageCondition = "ambient" | "refrigerated" | "frozen" | "ultra_cold";

/** Storage ranges in °C per condition. Demo defaults; confirm per product (docs/DOMAIN.md §Realism). */
export const STORAGE_RANGES: Record<StorageCondition, { minC: number; maxC: number }> = {
  ambient: { minC: 15, maxC: 25 },
  refrigerated: { minC: 2, maxC: 8 },
  frozen: { minC: -25, maxC: -15 },
  ultra_cold: { minC: -90, maxC: -60 },
};

export const COLD_CHAIN_RANGE = STORAGE_RANGES.refrigerated;

export function checkReading(r: Reading, range = COLD_CHAIN_RANGE): WatcherEvent | null {
  if (r.metric === "temp_c" && r.subjectTable === "shipments") {
    if (r.value < range.minC || r.value > range.maxC) {
      return { name: "shipment/temp_excursion", data: { ...r, range } };
    }
    return null;
  }
  const t = THRESHOLDS[r.metric];
  if (t && r.value >= t.alert) {
    return { name: "sensor/anomaly", data: { ...r, level: r.value >= t.action ? "action" : "alert" } };
  }
  return null;
}

/** Rising trend over consecutive readings, e.g. EM counts climbing for three days. */
export function isRising(values: number[], minSteps = 3): boolean {
  if (values.length < minSteps + 1) return false;
  const tail = values.slice(-(minSteps + 1));
  return tail.every((v, i) => i === 0 || v > (tail[i - 1] ?? Number.POSITIVE_INFINITY));
}
