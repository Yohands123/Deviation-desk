/**
 * Debrief scoring for a finished drill, computed from facts in code. The Auditor agent writes the
 * narrative; these numbers do not depend on it.
 */
import type { HiddenTruth } from "./scenario";
import { matchesRootCause, namesCauseObject } from "./scoring";

export interface DrillFacts {
  hiddenTruth: HiddenTruth;
  /** The team's latest root-cause proposal, if any. */
  rootCause: { summary: string; cause: string; causeObject: unknown; accepted: boolean } | null;
  durationTicks: number;
  containWithinTicks: number;
  /** First tick at which the hidden spread could no longer move; null if it never stopped. */
  containedAtTick: number | null;
  /** How many objects the true contamination reached. */
  spreadReached: number;
  mustProtect: Array<{ code: string; reached: boolean }>;
  /** Ticks each seat took per decision; null where a decision never came. */
  decisions: Array<{ seat: string; ticks: number | null; byAi: boolean }>;
  fabricatedSources: number;
  costUsd: number;
}

export interface SeatTiming {
  seat: string;
  decided: number;
  undecided: number;
  averageTicks: number | null;
  byAi: boolean;
}

export interface DrillScore {
  rootCauseCorrect: boolean | null;
  rootCauseAccepted: boolean;
  ticksToContain: number | null;
  containedInTime: boolean;
  spreadReached: number;
  protectedAll: boolean;
  unprotected: string[];
  seats: SeatTiming[];
  fabricatedSources: number;
  costUsd: number;
  /** 0–100: root cause 30, containment 30, protection 20, decision speed 10, no fabrication 10. */
  overall: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeDrillScore(f: DrillFacts): DrillScore {
  const rc = f.rootCause;
  const rootCauseCorrect = rc
    ? namesCauseObject(rc.causeObject, f.hiddenTruth.causeObject) || matchesRootCause(`${rc.summary} ${rc.cause}`, f.hiddenTruth.acceptableAnswers)
    : null;

  const containedInTime = f.containedAtTick !== null && f.containedAtTick <= f.containWithinTicks;
  const unprotected = f.mustProtect.filter((m) => m.reached).map((m) => m.code);

  const bySeat = new Map<string, SeatTiming>();
  for (const d of f.decisions) {
    const s = bySeat.get(d.seat) ?? { seat: d.seat, decided: 0, undecided: 0, averageTicks: null, byAi: d.byAi };
    if (d.ticks === null) s.undecided++;
    else {
      s.averageTicks = round1(((s.averageTicks ?? 0) * s.decided + d.ticks) / (s.decided + 1));
      s.decided++;
    }
    s.byAi = s.byAi && d.byAi;
    bySeat.set(d.seat, s);
  }
  const seats = [...bySeat.values()].sort((a, b) => a.seat.localeCompare(b.seat));

  const decided = f.decisions.filter((d) => d.ticks !== null);
  const avg = decided.length ? decided.reduce((t, d) => t + (d.ticks ?? 0), 0) / decided.length : null;

  let overall = 0;
  if (rootCauseCorrect) overall += rc?.accepted ? 30 : 20;
  if (containedInTime) overall += 30;
  else if (f.containedAtTick !== null) overall += Math.max(0, 30 - 5 * (f.containedAtTick - f.containWithinTicks));
  overall += f.mustProtect.length === 0 ? 20 : Math.round((20 * (f.mustProtect.length - unprotected.length)) / f.mustProtect.length);
  if (avg !== null) overall += avg <= 2 ? 10 : avg <= 4 ? 5 : 0;
  if (f.fabricatedSources === 0) overall += 10;

  return {
    rootCauseCorrect,
    rootCauseAccepted: rc?.accepted ?? false,
    ticksToContain: f.containedAtTick,
    containedInTime,
    spreadReached: f.spreadReached,
    protectedAll: unprotected.length === 0,
    unprotected,
    seats,
    fabricatedSources: f.fabricatedSources,
    costUsd: Math.round(f.costUsd * 1000) / 1000,
    overall: Math.max(0, Math.min(100, overall)),
  };
}
