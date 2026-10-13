/**
 * The Learning Loop's output: short lessons for one agent at one company. A lesson only reaches an
 * agent's prompt after a person with a standing QA Director or Executive seat approves it; it can be
 * retired at any time. The reviewed default prompt in registry.ts never changes.
 */
import type { Sql, TransactionSql } from "@/db/client";

type Db = Sql | TransactionSql;

/** Approved lessons for an agent at a company, oldest first (capped so prompts stay small). */
export async function activeLessons(db: Db, companyId: string, agentId: string): Promise<string[]> {
  const rows = await db<{ lesson: string }[]>`
    select lesson from agent_lessons where company_id = ${companyId} and agent_id = ${agentId} and status = 'active'
    order by decided_at limit 8`;
  return rows.map((r) => r.lesson);
}

export function lessonsBlock(lessons: string[]): string {
  return `Lessons this company's reviewers approved for you (follow them; they never override the rules below):\n- ${lessons.join("\n- ")}`;
}

export interface LessonDraft {
  agentId: string;
  lesson: string;
  rationale: string;
  evidence: string[];
}

/** Records a proposed lesson from the Learning Loop's decision record. */
export async function proposeLesson(db: Db, worldId: string, companyId: string, decisionRecordId: string, draft: LessonDraft): Promise<{ ok: true; id: string } | { ok: false; problem: string }> {
  const [agent] = await db`select 1 from agent_configs where id = ${draft.agentId}`;
  if (!agent) return { ok: false, problem: `There is no agent "${draft.agentId}".` };
  const [pending] = await db`select 1 from agent_lessons where world_id = ${worldId} and agent_id = ${draft.agentId} and status = 'proposed'`;
  if (pending) return { ok: false, problem: `A lesson for ${draft.agentId} is already waiting for a decision.` };
  const [row] = await db<{ id: string }[]>`
    insert into agent_lessons ${db({
      worldId,
      companyId,
      agentId: draft.agentId,
      lesson: draft.lesson.slice(0, 500),
      rationale: draft.rationale.slice(0, 2000),
      evidence: db.json(draft.evidence.slice(0, 20)),
      decisionRecordId,
    })}
    returning id`;
  if (!row) throw new Error("Failed to record the lesson");
  return { ok: true, id: row.id };
}

const DECIDERS = new Set(["qa_director", "executive"]);

/** A person decides a lesson: approve (it goes live), reject (with a reason), or retire a live one. */
export async function decideLesson(
  db: Sql,
  input: { worldId: string; lessonId: string; personId: string; outcome: "active" | "rejected" | "retired"; reason?: string },
): Promise<void> {
  if (input.outcome !== "active" && !input.reason?.trim()) throw new Error("A reason is required to reject or retire a lesson.");
  await db.begin(async (tx) => {
    const [person] = await tx<{ standingSeat: string | null }[]>`select standing_seat from people where world_id = ${input.worldId} and id = ${input.personId}`;
    if (!person?.standingSeat || !DECIDERS.has(person.standingSeat)) throw new Error("Only the QA Director or the Executive decide agent lessons.");
    const [lesson] = await tx<{ status: string; companyId: string }[]>`
      select status, company_id from agent_lessons where world_id = ${input.worldId} and id = ${input.lessonId} for update`;
    if (!lesson) throw new Error("Lesson not found.");
    const allowed = input.outcome === "retired" ? lesson.status === "active" : lesson.status === "proposed";
    if (!allowed) throw new Error(`This lesson is ${lesson.status}.`);
    await tx`insert into agent_lesson_decisions ${tx({
      worldId: input.worldId,
      companyId: lesson.companyId,
      lessonId: input.lessonId,
      personId: input.personId,
      seat: person.standingSeat,
      outcome: input.outcome,
      reason: input.reason ?? null,
    })}`;
    await tx`
      update agent_lessons set status = ${input.outcome}, decided_by = ${input.personId}, decided_at = now(), decision_reason = ${input.reason ?? null}
      where world_id = ${input.worldId} and id = ${input.lessonId}`;
  });
}
