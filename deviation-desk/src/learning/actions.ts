"use server";
/** Agents page actions: run the Learning Loop now, and decide lessons. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql } from "@/db/client";
import { requireViewer } from "@/incident-room/viewer";
import { emit } from "@/workflows/emit";
import { MIN_PUSHBACK_FOR_LEARNING } from "@/workflows/oversight-handlers";
import { decideLesson } from "./lessons";
import { pushback } from "./track-records";

type Result = { ok: true; message?: string } | { ok: false; error: string };
const fail = (err: unknown): Result => ({ ok: false, error: err instanceof z.ZodError ? "Check the details." : err instanceof Error ? err.message : "Something went wrong." });

export async function runLearningNow(): Promise<Result> {
  try {
    const viewer = await requireViewer();
    const items = (await pushback(getSql(), viewer.worldId)).length;
    if (items < MIN_PUSHBACK_FOR_LEARNING) return { ok: true, message: `Nothing to learn from yet: people pushed back ${items} time(s) in the last 30 days.` };
    const started = await emit({ name: "learning/review", data: { worldId: viewer.worldId, companyId: viewer.companyId } });
    return started ? { ok: true, message: "The Learning Loop is reading the pushback." } : { ok: false, error: "The workflow engine is not running (npm run inngest)." };
  } catch (err) {
    return fail(err);
  }
}

const DecideInput = z.object({ lessonId: z.uuid(), outcome: z.enum(["active", "rejected", "retired"]), reason: z.string().trim().max(2000).optional() });

export async function decideLessonAction(raw: z.input<typeof DecideInput>): Promise<Result> {
  try {
    const input = DecideInput.parse(raw);
    const viewer = await requireViewer();
    await decideLesson(getSql(), { worldId: viewer.worldId, lessonId: input.lessonId, personId: viewer.personId, outcome: input.outcome, reason: input.reason || undefined });
    revalidatePath("/agents");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
