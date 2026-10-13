/**
 * Matching a proposed root cause against a hidden truth. Shared by the eval harness and the drill
 * debrief so both judge the same way.
 */

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
