/**
 * Eval harness (CLAUDE.md §13). For each scenario:
 *  1. seed a fresh Helix Biologics company and clone a drill world with the scenario's seed
 *  2. apply the trigger and run the agent chain in-process (same handlers Inngest runs)
 *  3. score against the hidden truth and expectations; the hidden truth is used only here
 * Usage: npm run evals [-- scenario-id ...]. Exits 1 if any scenario fails: a fabricated source,
 * a required agent that did not run, a wrong root cause, or an error.
 * Twists and containment metrics are not scored until Phases 3 and 6.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { closeSql, getSql, type Sql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { SEED_ANCHOR, seedHelixBiologics } from "@/db/seed/helix-biologics";
import { HiddenTruth, Scenario } from "@/sim/scenario";
import { runLocally } from "@/workflows/local-runner";
import { aggregate, matchesRootCause, missingAgents, namesCauseObject, passed, type Score } from "./score";
import { applyTrigger } from "./triggers";

const ScenarioFile = z.object({
  id: z.string(),
  seed: z.number().int(),
  scenario: Scenario,
  hiddenTruth: HiddenTruth,
  expectations: z
    .object({
      maxFabricatedSources: z.number().int().default(0),
      agentsThatMustRun: z.array(z.string()).default([]),
    })
    .default({ maxFabricatedSources: 0, agentsThatMustRun: [] }),
});
type ScenarioFile = z.infer<typeof ScenarioFile>;

function loadScenarios(dir: string, only: string[]): ScenarioFile[] {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ScenarioFile.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
  if (only.length === 0) return all;
  const unknown = only.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length > 0) throw new Error(`Unknown scenario(s): ${unknown.join(", ")}`);
  return all.filter((s) => only.includes(s.id));
}

const RootCauseRecord = z.object({
  answer: z.object({
    summary: z.string(),
    reasoning: z.string(),
    sources: z.array(z.object({ table: z.string(), rowId: z.string() })),
    proposedAction: z.object({ type: z.string(), params: z.record(z.string(), z.unknown()) }).optional(),
  }),
});

async function scoreWorld(sql: Sql, s: ScenarioFile, worldId: string): Promise<Omit<Score, "id" | "durationMs" | "error">> {
  const runs = await sql<{ agentId: string; cost: number }[]>`
    select agent_id, coalesce(sum(cost_usd), 0)::float8 as cost from agent_runs where world_id = ${worldId} group by agent_id`;
  const [fabricated] = await sql<{ n: number }[]>`
    select coalesce(sum(jsonb_array_length(coalesce(record -> 'rejectedSources', '[]'::jsonb))), 0)::int as n
    from decision_records where world_id = ${worldId}`;
  const [proposal] = await sql<{ record: unknown }[]>`
    select record from decision_records
    where world_id = ${worldId} and agent_id = 'root_cause_analyst' order by created_at desc limit 1`;

  let rootCauseCorrect = false;
  let citesCauseObject = false;
  if (proposal) {
    const { answer } = RootCauseRecord.parse(proposal.record);
    const params = answer.proposedAction?.type === "accept_root_cause" ? answer.proposedAction.params : {};
    const cause = typeof params.cause === "string" ? params.cause : "";
    const named = namesCauseObject(params.causeObject, s.hiddenTruth.causeObject);
    rootCauseCorrect = named || matchesRootCause(`${answer.summary} ${cause}`, s.hiddenTruth.acceptableAnswers);
    const causeId = await resolveRef(sql, worldId, s.hiddenTruth.causeObject).catch(() => null);
    citesCauseObject = answer.sources.some((src) => src.rowId === causeId);
  }

  return {
    rootCauseCorrect,
    citesCauseObject,
    agentsMissing: missingAgents(s.expectations.agentsThatMustRun, runs.map((r) => r.agentId)),
    fabricatedSources: fabricated?.n ?? 0,
    costUsd: runs.reduce((sum, r) => sum + r.cost, 0),
    ticksToContain: null,
    spreadReached: null,
    skippedSopSteps: null,
  };
}

async function runOne(sql: Sql, s: ScenarioFile): Promise<Score> {
  const started = Date.now();
  let drillWorldId: string | null = null;
  let error: string | null = null;
  try {
    const company = await seedHelixBiologics(sql, `Helix Biologics (eval ${s.id} ${new Date().toISOString()})`);
    const drill = await createDrillWorld(sql, company.worldId, s.seed, { simClock: SEED_ANCHOR });
    drillWorldId = drill.id;
    const first = await applyTrigger(sql, { worldId: drill.id, companyId: company.companyId, simClock: SEED_ANCHOR }, s.scenario.trigger);
    const events = await runLocally(first);
    console.log(`  ${s.id}: ${events.map((e) => e.name).join(" → ")}`);
  } catch (err) {
    console.error(`  ${s.id} failed:`, err);
    error = err instanceof Error ? err.message : String(err);
  }

  const empty = {
    rootCauseCorrect: false,
    citesCauseObject: false,
    agentsMissing: s.expectations.agentsThatMustRun,
    fabricatedSources: 0,
    costUsd: 0,
    ticksToContain: null,
    spreadReached: null,
    skippedSopSteps: null,
  };
  // Score whatever happened, even after an error, so the cost of a failed run is still reported.
  const scored = drillWorldId ? await scoreWorld(sql, s, drillWorldId) : empty;
  return { id: s.id, durationMs: Date.now() - started, error, ...scored };
}

async function main() {
  const sql = getSql();
  const scenarios = loadScenarios(join(__dirname, "scenarios"), process.argv.slice(2));
  console.log(`Running ${scenarios.length} scenario(s): ${scenarios.map((s) => s.id).join(", ")}`);

  const scores: Score[] = [];
  for (const s of scenarios) scores.push(await runOne(sql, s));

  console.table(
    scores.map((s) => ({
      scenario: s.id,
      pass: passed(s),
      rootCause: s.rootCauseCorrect,
      citesCause: s.citesCauseObject,
      fabricated: s.fabricatedSources,
      missingAgents: s.agentsMissing.join(", ") || "-",
      costUsd: s.costUsd.toFixed(3),
      seconds: Math.round(s.durationMs / 1000),
      error: s.error ?? "-",
    })),
  );
  const score = aggregate(scores);
  console.log(`Aggregate: ${(score * 100).toFixed(0)}% passed, total cost $${scores.reduce((t, s) => t + s.costUsd, 0).toFixed(3)}`);

  const outDir = join(__dirname, ".results");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ aggregate: score, scores }, null, 2));
  console.log(`Results: ${file}`);

  if (!scores.every(passed)) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeSql);
