"use server";
/** Strategy page actions: run the review, ask the Launch Planner, re-simulate, decide a proposal. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql } from "@/db/client";
import { requireViewer } from "@/incident-room/viewer";
import { emit } from "@/workflows/emit";
import { Change } from "./change";
import { decideProposal } from "./proposals";
import { simulateProposal } from "./simulate";

type Result = { ok: true; message?: string } | { ok: false; error: string };

const ENGINE_DOWN = "The workflow engine is not running, so agents have not started (npm run inngest).";
const fail = (err: unknown): Result => ({ ok: false, error: err instanceof z.ZodError ? "Check the details." : err instanceof Error ? err.message : "Something went wrong." });

export async function runReviewNow(): Promise<Result> {
  try {
    const viewer = await requireViewer();
    const started = await emit({ name: "expansion/sweep", data: { worldId: viewer.worldId, companyId: viewer.companyId, requestedBy: viewer.name } });
    return started ? { ok: true, message: "The review is running: three planners, then simulations, readiness and ranking. This takes a few minutes." } : { ok: false, error: ENGINE_DOWN };
  } catch (err) {
    return fail(err);
  }
}

export async function askLaunchPlanner(request: string): Promise<Result> {
  try {
    const text = z.string().trim().min(10).max(4000).parse(request);
    const viewer = await requireViewer();
    const started = await emit({ name: "expansion/requested", data: { worldId: viewer.worldId, companyId: viewer.companyId, personName: viewer.name, request: text } });
    return started ? { ok: true, message: "The Launch Planner is mapping the requirements." } : { ok: false, error: ENGINE_DOWN };
  } catch (err) {
    return fail(err);
  }
}

/** Runs the stress tests again on today's company; code and the optimizer only, no model cost. */
export async function simulateAgain(proposalId: string): Promise<Result> {
  try {
    const id = z.uuid().parse(proposalId);
    const viewer = await requireViewer();
    const sql = getSql();
    const [p] = await sql<{ change: unknown }[]>`select change from expansion_proposals where world_id = ${viewer.worldId} and id = ${id}`;
    if (!p) throw new Error("Proposal not found.");
    await simulateProposal(sql, viewer.worldId, viewer.companyId, id, Change.parse(p.change));
    revalidatePath("/strategy");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const DecideInput = z.object({ proposalId: z.uuid(), outcome: z.enum(["approved", "rejected"]), reason: z.string().trim().max(2000).optional() });

export async function decideExpansion(raw: z.input<typeof DecideInput>): Promise<Result> {
  try {
    const input = DecideInput.parse(raw);
    const viewer = await requireViewer();
    const result = await decideProposal(getSql(), { worldId: viewer.worldId, proposalId: input.proposalId, personId: viewer.personId, outcome: input.outcome, reason: input.reason || undefined });
    revalidatePath("/strategy");
    return { ok: true, message: result.waitingFor === "executive" ? "Recorded. The spend also needs the Executive." : `Proposal ${result.status}.` };
  } catch (err) {
    return fail(err);
  }
}
