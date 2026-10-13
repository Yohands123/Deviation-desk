/**
 * Eval harness (Phase 2). For each scenario:
 *  1. create a fresh drill world from the seed company with the scenario's seed
 *  2. apply the trigger, run the agent chain, advance ticks, apply twists
 *  3. score against the hidden truth and expectations
 * CI fails if the aggregate score drops or any fabricated source appears (CLAUDE.md §13).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Scenario, HiddenTruth } from "../src/sim/scenario";

interface Score {
  id: string;
  rootCauseCorrect: boolean;
  ticksToContain: number | null;
  spreadReached: number;
  fabricatedSources: number;
  skippedSopSteps: number;
  costUsd: number;
}

function loadScenarios(dir: string) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
      return {
        id: String(raw.id),
        seed: Number(raw.seed),
        scenario: Scenario.parse(raw.scenario),
        hiddenTruth: HiddenTruth.parse(raw.hiddenTruth),
      };
    });
}

async function runOne(s: ReturnType<typeof loadScenarios>[number]): Promise<Score> {
  // TODO(Phase 2): createDrillWorld(liveWorldId, s.seed); run chain; score.
  void s;
  throw new Error("Eval harness not implemented yet");
}

async function main() {
  const scenarios = loadScenarios(join(__dirname, "scenarios"));
  console.log(`Loaded ${scenarios.length} scenario(s): ${scenarios.map((s) => s.id).join(", ")}`);
  const scores: Score[] = [];
  for (const s of scenarios) scores.push(await runOne(s));
  console.table(scores);
  if (scores.some((s) => s.fabricatedSources > 0)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
