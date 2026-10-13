/**
 * AI-played seats in drills (docs/DOMAIN.md §Realism: humans are not instant). They take a tick or
 * two to decide, miss messages at shift change, and sometimes push back once before approving.
 * Live worlds never use this: there, AI seats cannot approve at all.
 */
import { createRng } from "./prng";

export interface PendingApproval {
  decisionRecordId: string;
  seat: string;
  actionType: string;
  requestedTick: number;
  /** How many times this seat already asked for more evidence on it. */
  asks: number;
}

export interface AiSeatDecision {
  outcome: "approved" | "more_evidence";
  reason: string;
}

/** Shift changes at 07:00 and 19:00 site time; messages arriving then wait an extra tick. */
export const SHIFT_CHANGE_HOURS = [7, 19];
export const PUSHBACK_CHANCE = 0.15;

function seedFor(drillSeed: number, decisionRecordId: string): number {
  let h = drillSeed >>> 0;
  for (let i = 0; i < decisionRecordId.length; i++) h = (Math.imul(h, 31) + decisionRecordId.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * The AI seat's decision this tick, or null to keep waiting. Each decision draws from its own
 * seeded stream, so the order decisions are checked in never changes the outcome.
 */
export function aiSeatDecision(p: PendingApproval, tick: number, siteHourAtRequest: number, drillSeed: number): AiSeatDecision | null {
  const rng = createRng(seedFor(drillSeed, p.decisionRecordId) + p.asks);
  const responseTicks = 1 + (rng.next() < 0.5 ? 1 : 0) + (SHIFT_CHANGE_HOURS.includes(siteHourAtRequest) ? 1 : 0);
  if (tick - p.requestedTick < responseTicks) return null;
  if (p.asks === 0 && rng.next() < PUSHBACK_CHANCE) {
    return { outcome: "more_evidence", reason: "AI-played seat: wants one more check before deciding." };
  }
  return { outcome: "approved", reason: "AI-played seat: approved after review." };
}
