/**
 * Side-by-side of two stress-test runs, in plain terms: what the change does to each measure.
 * Pure; used by the Strategy page and the tools that let agents read a simulation.
 */
import type { StressResult } from "./simulate";

export interface ComparisonRow {
  measure: string;
  baseline: string;
  withChange: string;
  effect: "better" | "worse" | "same";
  /** e.g. "5 days sooner", "1 fewer". Empty when the same. */
  note: string;
}

const HOUR_MS = 3_600_000;

function sooner(a: string | null, b: string | null): { effect: ComparisonRow["effect"]; note: string } {
  if (a === b || (a && b && Math.abs(Date.parse(a) - Date.parse(b)) < HOUR_MS)) return { effect: "same", note: "" };
  if (a === null) return { effect: "better", note: "now possible" };
  if (b === null) return { effect: "worse", note: "no longer possible" };
  const hours = Math.round((Date.parse(a) - Date.parse(b)) / HOUR_MS);
  const span = Math.abs(hours) >= 48 ? `${Math.round(Math.abs(hours) / 24)} days` : `${Math.abs(hours)} hours`;
  return hours > 0 ? { effect: "better", note: `${span} sooner` } : { effect: "worse", note: `${span} later` };
}

function count(measure: string, a: number, b: number, higherIsBetter: boolean, unit = ""): ComparisonRow {
  const diff = b - a;
  const effect = diff === 0 ? "same" : diff > 0 === higherIsBetter ? "better" : "worse";
  return { measure, baseline: `${a}${unit}`, withChange: `${b}${unit}`, effect, note: diff === 0 ? "" : `${diff > 0 ? "+" : ""}${diff}${unit}` };
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "not possible");

export function compareStress(baseline: StressResult, withChange: StressResult): ComparisonRow[] {
  const rows: ComparisonRow[] = baseline.orders.map((o, i) => {
    const w = withChange.orders[i];
    return { measure: `${o.name} (${o.quantity.toLocaleString("en-CA")} units) arrives`, baseline: day(o.arrivesAt), withChange: day(w?.arrivesAt ?? null), ...sooner(o.arrivesAt, w?.arrivesAt ?? null) };
  });
  rows.push(count("Stress orders on time", baseline.onTime, withChange.onTime, true, ` of ${baseline.orders.length}`));
  rows.push({
    measure: `Surge arrives with ${baseline.outage.haltedLine ?? "a line"} down`,
    baseline: day(baseline.outage.surgeArrivesAt),
    withChange: day(withChange.outage.surgeArrivesAt),
    ...sooner(baseline.outage.surgeArrivesAt, withChange.outage.surgeArrivesAt),
  });
  rows.push(count("Fill lines running during that outage", baseline.outage.linesLeft, withChange.outage.linesLeft, true));
  rows.push(count("Single-source materials", baseline.singleSourceMaterials.length, withChange.singleSourceMaterials.length, false));
  rows.push(count("Sterility test slots", baseline.capacity.testSlots, withChange.capacity.testSlots, true));
  rows.push(count("QA batch reviews per day", baseline.capacity.qaReviewsPerDay, withChange.capacity.qaReviewsPerDay, true));
  return rows;
}
