/**
 * The scenario library: the curated scenario files (evals/scenarios) loaded into a company's
 * scenarios, each with its hidden truth stored separately (CLAUDE.md §9).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Sql } from "@/db/client";
import { HiddenTruth, Scenario } from "./scenario";

export const ScenarioFile = z.object({
  id: z.string(),
  seed: z.number().int(),
  scenario: Scenario,
  hiddenTruth: HiddenTruth,
  /** Eval-only files (several incidents, scripted conflicts) are not drills a team can run. */
  evalOnly: z.boolean().default(false),
});
export type ScenarioFile = z.infer<typeof ScenarioFile>;

export function readScenarioFiles(dir: string): ScenarioFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ScenarioFile.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))))
    .filter((f) => !f.evalOnly);
}

/** Adds library scenarios a company does not have yet. Returns the titles added. */
export async function seedScenarioLibrary(sql: Sql, companyId: string, files: ScenarioFile[]): Promise<string[]> {
  const added: string[] = [];
  for (const f of files) {
    await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into scenarios ${tx({
          companyId,
          title: f.scenario.title,
          spec: tx.json(f.scenario as unknown as Parameters<typeof tx.json>[0]),
          createdBy: `library:${f.id}`,
          approved: true,
          approvedAt: new Date(),
          source: "library",
        })}
        on conflict (company_id, title) where source = 'library' do nothing
        returning id`;
      if (!row) return;
      await tx`insert into hidden_truths ${tx({ scenarioId: row.id, truth: tx.json(f.hiddenTruth as unknown as Parameters<typeof tx.json>[0]) })}`;
      added.push(f.scenario.title);
    });
  }
  return added;
}
