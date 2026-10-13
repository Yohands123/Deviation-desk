/**
 * The hidden spread (CLAUDE.md §9): from the true source, contamination crosses impact-graph edges
 * with a per-tick probability. Holds and quarantines cut edges. Deterministic for a given seed.
 * Node keys are "table:id".
 */
import type { Rng } from "./prng";

export type EdgeKind = "equipment" | "material_lot" | "shipment";

export interface SpreadEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

const crossable = (e: SpreadEdge, affected: Set<string>, contained: Set<string>, kinds: Set<EdgeKind>) =>
  kinds.has(e.kind) && affected.has(e.from) && !affected.has(e.to) && !contained.has(e.from) && !contained.has(e.to);

/** Edges in a fixed order so random draws line up the same way on every replay. */
function ordered(edges: SpreadEdge[]): SpreadEdge[] {
  return [...edges].sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
}

/** One tick of spread. Returns the newly affected nodes. */
export function spreadStep(
  affected: Set<string>,
  edges: SpreadEdge[],
  contained: Set<string>,
  kinds: Set<EdgeKind>,
  probability: number,
  rng: Rng,
): string[] {
  const reached = new Set<string>();
  for (const e of ordered(edges)) {
    if (!crossable(e, affected, contained, kinds)) continue;
    // Always draw, even if the target was already reached this tick, to keep draws aligned.
    const hit = rng.next() < probability;
    if (hit) reached.add(e.to);
  }
  return [...reached].sort();
}

/** True while some uncontained affected node still has an open edge to an unaffected node. */
export function canStillSpread(affected: Set<string>, edges: SpreadEdge[], contained: Set<string>, kinds: Set<EdgeKind>): boolean {
  return edges.some((e) => crossable(e, affected, contained, kinds));
}
