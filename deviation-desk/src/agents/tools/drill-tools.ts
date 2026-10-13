/**
 * Tools for the drill agents. The hidden truth and the full drill record (including the true spread
 * and which events the saboteurs caused) are released only to the Auditor, only after the drill has
 * ended (CLAUDE.md §9).
 */
import { z } from "zod";
import { getSql, type Sql } from "@/db/client";
import { computeDrillScore } from "@/sim/drill-score";
import { loadHiddenTruth } from "@/sim/drill-state";
import { gatherFacts } from "@/sim/drills";
import { validateScenario } from "@/sim/validate-scenario";
import type { AgentTool, ToolContext } from "./types";

async function endedDrillForAuditor(sql: Sql, ctx: ToolContext): Promise<{ id: string; scenarioId: string }> {
  const [run] = await sql<{ id: string; scenarioId: string; status: string }[]>`
    select id, scenario_id, status from drill_runs where world_id = ${ctx.worldId}`;
  if (ctx.agentId !== "auditor" || !run || run.status !== "ended") {
    throw new Error("The hidden truth and the full drill record are only available to the Auditor after the drill ends.");
  }
  return run;
}

const validateInput = z.object({
  scenarioJson: z.string().describe("The Scenario object as a JSON string."),
  hiddenTruthJson: z.string().describe("The HiddenTruth object as a JSON string."),
});

export const validateScenarioTool: AgentTool<typeof validateInput> = {
  name: "validate_scenario",
  description:
    "Check a draft scenario and its hidden truth: schema, that every named object exists in the twin, and that the timeline is physically possible. Returns the problems to fix, or valid: true.",
  input: validateInput,
  async run({ scenarioJson, hiddenTruthJson }, ctx) {
    const parse = (text: string) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    };
    const check = await validateScenario(getSql(), ctx.worldId, parse(scenarioJson), parse(hiddenTruthJson));
    return { valid: check.valid, problems: check.problems };
  },
};

const empty = z.object({});

export const getIncidentTimeline: AgentTool<typeof empty> = {
  name: "get_incident_timeline",
  description:
    'The incident\'s full timeline: every event (who, which seat, when) and every agent decision with its summary, kind and decision status. Cite events as "incident_events" and decisions as "decision_records".',
  input: empty,
  async run(_input, ctx) {
    if (!ctx.incidentId) throw new Error("This run is not attached to an incident.");
    const sql = getSql();
    const events = await sql`
      select id::text as id, created_at, actor_type, actor_id, seat, event_type, payload
      from incident_events where world_id = ${ctx.worldId} and incident_id = ${ctx.incidentId} and event_type <> 'dedupe'
      order by id limit 200`;
    const decisions = await sql`
      select d.id, d.created_at, d.agent_id, d.record -> 'answer' ->> 'kind' as kind, d.record -> 'answer' ->> 'summary' as summary,
        d.record -> 'answer' -> 'proposedAction' ->> 'type' as action,
        (select a.outcome from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id order by a.created_at desc limit 1) as decision
      from decision_records d where d.world_id = ${ctx.worldId} and d.incident_id = ${ctx.incidentId} order by d.created_at limit 100`;
    return { citeAs: { events: "incident_events", decisions: "decision_records" }, events, decisions };
  },
};

export const getDrillFacts: AgentTool<typeof empty> = {
  name: "get_drill_facts",
  description:
    "After the drill: the computed score (root cause, containment, spread, protected objects, decision times per seat) and the simulation log, including the true spread and which events the saboteurs caused.",
  input: empty,
  async run(_input, ctx) {
    const sql = getSql();
    const run = await endedDrillForAuditor(sql, ctx);
    const score = computeDrillScore(await gatherFacts(sql, run.id));
    const log = await sql`
      select tick, actor, effect_type, target_label, description, hidden from sim_effects
      where world_id = ${ctx.worldId} and effect_type not in ('tick', 'started') order by tick, id limit 200`;
    return { score, simulationLog: log };
  },
};

export const getHiddenTruth: AgentTool<typeof empty> = {
  name: "get_hidden_truth",
  description: "After the drill: the scenario's hidden truth (the real root cause and acceptable answers).",
  input: empty,
  async run(_input, ctx) {
    const sql = getSql();
    const run = await endedDrillForAuditor(sql, ctx);
    return { hiddenTruth: await loadHiddenTruth(sql, run.scenarioId) };
  },
};
