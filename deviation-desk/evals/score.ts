/**
 * Pure scoring helpers for the eval harness. No database or model access here.
 */

export interface Score {
  id: string;
  rootCauseCorrect: boolean;
  /** The root-cause proposal cites the cause object's row as a source. */
  citesCauseObject: boolean;
  agentsMissing: string[];
  fabricatedSources: number;
  costUsd: number;
  durationMs: number;
  /** Not scored until containment (Phase 3) and the sim clock (Phase 6) exist. */
  ticksToContain: number | null;
  spreadReached: number | null;
  skippedSopSteps: number | null;
  error: string | null;
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[‐-―]/g, "-")
      .split(/[^a-z0-9-]+/)
      .filter(Boolean),
  );

/**
 * Correct when the proposal contains every word of any acceptable answer, in any order
 * ("worn filling-needle gasket" matches "worn gasket"). Score the summary and the proposed
 * cause, not the reasoning, which also discusses the alternatives it rejected.
 */
export function matchesRootCause(proposalText: string, acceptableAnswers: string[]): boolean {
  const text = words(proposalText);
  return acceptableAnswers.some((answer) => [...words(answer)].every((w) => text.has(w)));
}

/** Structured check: the proposal's causeObject names the hidden truth's cause object. */
export function namesCauseObject(causeObject: unknown, truth: { table: string; code: string }): boolean {
  if (typeof causeObject !== "object" || causeObject === null) return false;
  const { table, code } = causeObject as { table?: unknown; code?: unknown };
  return table === truth.table && typeof code === "string" && code.toLowerCase() === truth.code.toLowerCase();
}

export function missingAgents(required: string[], ran: string[]): string[] {
  const seen = new Set(ran);
  return required.filter((id) => !seen.has(id));
}

/** A scenario passes when nothing blocking happened (CLAUDE.md §13). */
export function passed(score: Score): boolean {
  return score.error === null && score.fabricatedSources === 0 && score.agentsMissing.length === 0 && score.rootCauseCorrect;
}

/** Share of scenarios passed, 0..1. CI compares this against the previous run. */
export function aggregate(scores: Score[]): number {
  if (scores.length === 0) return 0;
  return scores.filter(passed).length / scores.length;
}
