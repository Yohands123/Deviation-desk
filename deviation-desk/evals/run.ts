/**
 * Eval harness (CLAUDE.md §13). For each scenario:
 *  1. seed a fresh Helix Biologics company and clone a drill world with the scenario's seed
 *  2. apply the trigger and run the agent chains in-process (the same handlers Inngest runs),
 *     with AI-played seats approving proposals so containment and logistics can follow
 *  3. score against the hidden truth and expectations; the hidden truth is used only here
 * Usage: npm run evals [-- scenario-id ...]. Needs the local database and the optimizer
 * (npm run optimizer). Exits 1 if any scenario fails: a fabricated source, a required agent or
 * proposal missing, a wrong root cause, or an error.
 * Twists, time to containment and spread reached need the sim clock (Phase 6).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { syncAgentConfigs } from "@/agents/configs";
import { defaultAgents } from "@/agents/registry";
import { closeSql, getSql, type Sql } from "@/db/client";
import { createDrillWorld } from "@/db/create-drill-world";
import { resolveRef } from "@/db/resolve-ref";
import { SEED_ANCHOR, seedHelixBiologics } from "@/db/seed/helix-biologics";
import { optimizerIsUp } from "@/lib/optimizer";
import { HiddenTruth, Scenario } from "@/sim/scenario";
import { runLocally } from "@/workflows/local-runner";
import { aggregate, matchesRootCause, missingAgents, missingProposals, namesCauseObject, passed, type Score } from "./score";
import { applyTrigger } from "@/sim/triggers";

const Expectations = z.object({
  maxFabricatedSources: z.number().int().default(0),
  agentsThatMustRun: z.array(z.string()).default([]),
  /** Score the Root Cause Analyst's proposal against the hidden truth. */
  scoreRootCause: z.boolean().default(true),
  proposals: z.array(z.object({ actionType: z.string(), mentions: z.array(z.string()) })).default([]),
  /** Action types no agent may propose in this scenario. */
  forbiddenActions: z.array(z.string()).default([]),
});

const ScenarioFile = z.object({
  id: z.string(),
  seed: z.number().int(),
  scenario: Scenario,
  hiddenTruth: HiddenTruth,
  expectations: Expectations.default(Expectations.parse({})),
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

const StoredAnswer = z.object({
  answer: z.object({
    summary: z.string(),
    sources: z.array(z.object({ table: z.string(), rowId: z.string() })),
    proposedAction: z.object({ type: z.string(), params: z.record(z.string(), z.unknown()) }).optional(),
  }),
});

type Scored = Omit<Score, "id" | "durationMs" | "error">;

async function scoreWorld(sql: Sql, s: ScenarioFile, worldId: string): Promise<Scored> {
  const runs = await sql<{ agentId: string; cost: number }[]>`
    select agent_id, coalesce(sum(cost_usd), 0)::float8 as cost from agent_runs where world_id = ${worldId} group by agent_id`;
  const records = await sql<{ agentId: string; record: unknown; rejected: number }[]>`
    select agent_id, record, jsonb_array_length(coalesce(record -> 'rejectedSources', '[]'::jsonb)) as rejected
    from decision_records where world_id = ${worldId} order by created_at`;
  const parsed = records.map((r) => ({ agentId: r.agentId, rejected: r.rejected, ...StoredAnswer.parse(r.record) }));
  const made = parsed.flatMap((r) => (r.answer.proposedAction ? [{ actionType: r.answer.proposedAction.type, params: r.answer.proposedAction.params }] : []));

  let rootCauseCorrect: boolean | null = null;
  let citesCauseObject: boolean | null = null;
  if (s.expectations.scoreRootCause) {
    const proposal = parsed.filter((r) => r.agentId === "root_cause_analyst").at(-1);
    rootCauseCorrect = false;
    citesCauseObject = false;
    if (proposal) {
      const action = proposal.answer.proposedAction;
      const params = action?.type === "accept_root_cause" ? action.params : {};
      const cause = typeof params.cause === "string" ? params.cause : "";
      rootCauseCorrect =
        namesCauseObject(params.causeObject, s.hiddenTruth.causeObject) ||
        matchesRootCause(`${proposal.answer.summary} ${cause}`, s.hiddenTruth.acceptableAnswers);
      const causeId = await resolveRef(sql, worldId, s.hiddenTruth.causeObject).catch(() => null);
      citesCauseObject = proposal.answer.sources.some((src) => src.rowId === causeId);
    }
  }

  return {
    rootCauseCorrect,
    citesCauseObject,
    agentsMissing: missingAgents(s.expectations.agentsThatMustRun, runs.map((r) => r.agentId)),
    proposalsMissing: missingProposals(s.expectations.proposals, made),
    forbiddenProposals: [...new Set(made.map((p) => p.actionType).filter((t) => s.expectations.forbiddenActions.includes(t)))],
    fabricatedSources: parsed.reduce((n, r) => n + r.rejected, 0),
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
    const events = await runLocally(first, { autoApprove: true });
    console.log(`  ${s.id}: ${events.map((e) => e.name).join(" → ")}`);
  } catch (err) {
    console.error(`  ${s.id} failed:`, err);
    error = err instanceof Error ? err.message : String(err);
  }

  const empty: Scored = {
    rootCauseCorrect: s.expectations.scoreRootCause ? false : null,
    citesCauseObject: null,
    agentsMissing: s.expectations.agentsThatMustRun,
    proposalsMissing: [],
    forbiddenProposals: [],
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
  if (!(await optimizerIsUp())) throw new Error("The optimizer is not running. Start it with npm run optimizer, then rerun.");
  const changed = await syncAgentConfigs(sql, defaultAgents);
  if (changed.length > 0) console.log(`Synced agent configs: ${changed.join(", ")}`);

  const scenarios = loadScenarios(join(__dirname, "scenarios"), process.argv.slice(2));
  console.log(`Running ${scenarios.length} scenario(s): ${scenarios.map((s) => s.id).join(", ")}`);
  const scores: Score[] = [];
  for (const s of scenarios) scores.push(await runOne(sql, s));

  const show = (v: boolean | null) => (v === null ? "-" : v);
  console.table(
    scores.map((s) => ({
      scenario: s.id,
      pass: passed(s),
      rootCause: show(s.rootCauseCorrect),
      citesCause: show(s.citesCauseObject),
      fabricated: s.fabricatedSources,
      missingAgents: s.agentsMissing.join(", ") || "-",
      missingProposals: s.proposalsMissing.join("; ") || "-",
      forbidden: s.forbiddenProposals.join(", ") || "-",
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
