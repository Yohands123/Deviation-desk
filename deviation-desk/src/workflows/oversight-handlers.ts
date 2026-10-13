/**
 * Oversight and learning chains (Phase 7).
 *
 *   audit/sweep (hourly cron, only when code checks find new gaps) → Auditor (standard tier)
 *   incident/closed → Auditor closing review (deep): grades seats and the team
 *   learning/review (weekly cron, or "Run now") → Learning Loop → a proposed lesson people decide
 */
import "server-only";
import { z } from "zod";
import { ProposeLessonParams } from "@/agents/action-params";
import { proposeLesson } from "@/learning/lessons";
import { pushback } from "@/learning/track-records";
import { decide, incidentScope, sqlFor, type Handler, type NamedHandler } from "./agent-steps";
import { IncidentOpened } from "./events";
import { describeIncident } from "./incidents";

const AuditSweep = IncidentOpened.extend({ flags: z.array(z.object({ key: z.string(), text: z.string() })).min(1) });
const LearningReview = z.object({ worldId: z.uuid(), companyId: z.uuid() });
/** The Learning Loop runs only when people pushed back at least this often in the window. */
export const MIN_PUSHBACK_FOR_LEARNING = 2;

const sweepIncident: Handler = async (run, data) => {
  const e = AuditSweep.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  await run("auditor-sweep", () =>
    decide(sql, "auditor", scope, `Review 1 (sweep of an open incident). ${description} Rule checks found: ${e.flags.map((f) => f.text).join(" ")}`, undefined, { tier: "standard" }),
  );
  return [];
};

const closingReview: Handler = async (run, data) => {
  const scope = incidentScope(IncidentOpened.parse(data));
  const sql = sqlFor();
  const description = await run("describe-incident", () => describeIncident(sql, scope.worldId, scope.incidentId));
  await run("auditor-closing-review", () => decide(sql, "auditor", scope, `Review 2 (a live incident has closed). ${description} Grade each seat and the team, and list the top fixes.`));
  return [];
};

const learn: Handler = async (run, data) => {
  const e = LearningReview.parse(data);
  const sql = sqlFor();
  // No pushback, no lesson: a quiet week costs nothing.
  const items = await run("pushback", async () => (await pushback(sql, e.worldId)).length);
  if (items < MIN_PUSHBACK_FOR_LEARNING) return [];
  const result = await run("learning-loop", () =>
    decide(sql, "learning_loop", { worldId: e.worldId, companyId: e.companyId, incidentId: null }, `Weekly learning review: people pushed back ${items} time(s) in the last 30 days. Look for a repeated pattern.`),
  );
  const action = result.answer.proposedAction;
  const params = action?.type === "propose_lesson" ? ProposeLessonParams.safeParse(action.params) : null;
  if (params?.success) await run("record-lesson", () => proposeLesson(sql, e.worldId, e.companyId, result.decisionRecordId, params.data));
  return [];
};

export const oversightHandlers: Readonly<Record<string, readonly NamedHandler[]>> = {
  "audit/sweep": [{ id: "auditor-sweep", handle: sweepIncident }],
  "incident/closed": [{ id: "auditor-closing-review", handle: closingReview }],
  "learning/review": [{ id: "learning-loop", handle: learn }],
};
