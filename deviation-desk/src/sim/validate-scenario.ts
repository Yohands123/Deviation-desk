/**
 * Checks a scenario before anyone can approve it (CLAUDE.md §9): it parses, every object it names
 * exists in the twin, and its timeline is physically possible (docs/DOMAIN.md §Realism).
 */
import type { Sql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { worldClock } from "@/db/inventory";
import { EFFECT_TARGETS, normalizeEffectType, type TargetTable } from "./effects";
import { HiddenTruth, Scenario } from "./scenario";

export const TRIGGER_TYPES = ["sterility_failure", "em_anomaly", "temp_excursion", "supplier_delay"] as const;
export const MAX_DRILL_TICKS = 168; // a week of simulated hours
const DAY_MS = 86_400_000;

export interface ScenarioCheck {
  valid: boolean;
  problems: string[];
  scenario: Scenario | null;
  hiddenTruth: HiddenTruth | null;
}

export async function validateScenario(sql: Sql, worldId: string, rawScenario: unknown, rawTruth: unknown): Promise<ScenarioCheck> {
  const problems: string[] = [];
  const s = Scenario.safeParse(rawScenario);
  const t = HiddenTruth.safeParse(rawTruth);
  if (!s.success) problems.push(`Scenario does not match the schema: ${s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (!t.success) problems.push(`Hidden truth does not match the schema: ${t.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (!s.success || !t.success) return { valid: false, problems, scenario: null, hiddenTruth: null };
  const scenario = s.data;
  const truth = t.data;

  const exists = async (ref: { table: string; code: string }, what: string) => {
    const id = await resolveRef(sql, worldId, ref).catch(() => null);
    if (!id) problems.push(`${what}: no ${ref.table} "${ref.code}" in the twin.`);
    return id;
  };

  if (!(TRIGGER_TYPES as readonly string[]).includes(scenario.trigger.type)) {
    problems.push(`Trigger "${scenario.trigger.type}" is not supported. Use one of: ${TRIGGER_TYPES.join(", ")}.`);
  }
  const triggerId = await exists(scenario.trigger.target, "Trigger");
  await exists(truth.causeObject, "Hidden truth cause");
  for (const [i, r] of scenario.redHerrings.entries()) await exists(r.target, `Red herring ${i + 1}`);
  for (const [i, m] of scenario.success.mustProtect.entries()) await exists(m, `Protected object ${i + 1}`);

  for (const [i, tw] of scenario.twists.entries()) {
    const type = normalizeEffectType(tw.effect.type);
    if (!type) problems.push(`Twist ${i + 1}: unknown effect "${tw.effect.type}".`);
    else if (!EFFECT_TARGETS[type].includes(tw.effect.target.table as TargetTable)) problems.push(`Twist ${i + 1}: ${type} cannot target ${tw.effect.target.table}.`);
    if (tw.atTick > scenario.durationTicks) problems.push(`Twist ${i + 1} happens at hour ${tw.atTick}, after the drill ends (hour ${scenario.durationTicks}).`);
    await exists(tw.effect.target, `Twist ${i + 1}`);
  }

  if (scenario.durationTicks > MAX_DRILL_TICKS) problems.push(`A drill can run at most ${MAX_DRILL_TICKS} simulated hours.`);
  if (scenario.success.containWithinTicks > scenario.durationTicks) problems.push("The containment target is later than the end of the drill.");
  if (scenario.spread.perTickProbability > 0.5) problems.push("Spread probability above 0.5 per hour is not realistic.");

  // Physics does not speed up (principle 8): a sterility result needs its full incubation.
  if (scenario.trigger.type === "sterility_failure" && triggerId && scenario.trigger.target.table === "batches") {
    const [batch] = await sql<{ status: string; producedAt: Date | null; releaseTestDays: number }[]>`
      select b.status, b.produced_at, p.release_test_days from batches b join products p on p.world_id = b.world_id and p.id = b.product_id
      where b.world_id = ${worldId} and b.id = ${triggerId}`;
    const now = await worldClock(sql, worldId);
    if (batch?.status === "in_production") problems.push(`${scenario.trigger.target.code} is still in production; it has no sterility result yet.`);
    if (batch?.producedAt) {
      const earliest = new Date(batch.producedAt.getTime() + batch.releaseTestDays * DAY_MS);
      if (earliest > now) problems.push(`${scenario.trigger.target.code} was filled ${batch.producedAt.toISOString().slice(0, 10)}; its sterility result cannot exist before ${earliest.toISOString().slice(0, 10)}.`);
    }
  }

  return { valid: problems.length === 0, problems, scenario, hiddenTruth: truth };
}
