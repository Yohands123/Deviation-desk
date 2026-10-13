"use server";
/**
 * Server actions behind every Incident Room control. Each one re-derives the viewer from the
 * session and checks permissions here, never in the browser (CLAUDE.md §10). Every human input is
 * stored with author, seat, time and reason.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LinkToIncidentParams, OpenIncidentParams } from "@/agents/action-params";
import { loadAgent } from "@/agents/configs";
import { AgentAnswer, SeatRole } from "@/agents/contract";
import { runAgent } from "@/agents/runner";
import { takeSeat } from "@/approvals/seats";
import { getSql } from "@/db/client";
import { resolveRef } from "@/db/resolve-ref";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveDecision } from "@/workflows/decisions";
import { emit } from "@/workflows/emit";
import { addIncidentEvent, openIncident } from "@/workflows/incidents";
import { getSourceRecord, type SourceRecord } from "./queries";
import { LIVE_SEATS } from "./types";
import { getViewer, requireViewer, requireViewerIn, type Viewer } from "./viewer";

export type ActionResult<T = object> = ({ ok: true; warning?: string } & T) | { ok: false; error: string };

const ENGINE_DOWN = "Saved. The workflow engine is not running, so agents have not picked this up yet (npm run inngest).";

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof z.ZodError) return { ok: false, error: z.prettifyError(err) };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

async function incidentFor(viewer: Viewer, code: string) {
  const [incident] = await getSql()<{ id: string; companyId: string }[]>`
    select id, company_id from incidents where world_id = ${viewer.worldId} and code = ${code}`;
  if (!incident) throw new Error(`Incident ${code} not found.`);
  return { ...incident, scope: { worldId: viewer.worldId, companyId: viewer.companyId, incidentId: incident.id } };
}

/** Drills can switch agents off (a humans-only exercise); live worlds always have them. */
async function agentsRespond(viewer: Viewer): Promise<boolean> {
  const [run] = await getSql()<{ agentsEnabled: boolean }[]>`select agents_enabled from drill_runs where world_id = ${viewer.worldId}`;
  return run?.agentsEnabled ?? true;
}

const World = z.uuid().nullish();
const DRILL_SEATS = [...LIVE_SEATS, "facilitator"] as const;

async function seatOf(viewer: Viewer, incidentId: string): Promise<SeatRole | null> {
  const [row] = await getSql()<{ role: SeatRole }[]>`
    select role from seats where world_id = ${viewer.worldId} and incident_id = ${incidentId} and person_id = ${viewer.personId}`;
  return row?.role ?? null;
}

// ─── Session ─────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: "That email and password do not match." };
  if (!(await getViewer())) {
    await supabase.auth.signOut();
    return { ok: false, error: "This login is not linked to a person in any company." };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

// ─── Seats ───────────────────────────────────────────────────────────

export async function takeSeatAction(code: string, role: string, world?: string | null): Promise<ActionResult> {
  try {
    const viewer = await requireViewerIn(World.parse(world));
    // The facilitator seat exists only in drills.
    const seat = (world ? z.enum(DRILL_SEATS) : z.enum(LIVE_SEATS)).parse(role);
    const { id: incidentId, scope } = await incidentFor(viewer, code);
    const sql = getSql();
    const [current] = await sql<{ personId: string | null }[]>`
      select person_id from seats where world_id = ${viewer.worldId} and incident_id = ${incidentId} and role = ${seat}`;
    if (current?.personId && current.personId !== viewer.personId) throw new Error("Someone else holds that seat.");
    if (current?.personId === viewer.personId) return { ok: true }; // already yours
    // One playing seat per person per incident: the previous one goes back to AI. A drill's
    // facilitator keeps that role while also playing a seat.
    await sql`
      update seats set person_id = null
      where world_id = ${viewer.worldId} and incident_id = ${incidentId} and person_id = ${viewer.personId}
        and role <> ${seat} and role <> 'facilitator'`;
    await takeSeat(sql, { ...scope, role: seat, personId: viewer.personId });
    revalidatePath(`/incidents/${code}`);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

// ─── Decisions ───────────────────────────────────────────────────────

const DecideInput = z.object({
  code: z.string(),
  decisionRecordId: z.uuid(),
  outcome: z.enum(["approved", "rejected", "override", "more_evidence"]),
  reason: z.string().max(2000).optional(),
  world: World,
});

export async function decide(raw: z.input<typeof DecideInput>): Promise<ActionResult> {
  try {
    const input = DecideInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { id: incidentId } = await incidentFor(viewer, input.code);
    const seat = await seatOf(viewer, incidentId);
    if (!seat) throw new Error("Take a seat on this incident before deciding.");
    // recordApproval checks the seat may decide this action and that the viewer holds it.
    const { resumed } = await resolveDecision({
      worldId: viewer.worldId,
      decisionRecordId: input.decisionRecordId,
      seat,
      personId: viewer.personId,
      outcome: input.outcome,
      reason: input.reason?.trim() || undefined,
    });
    revalidatePath(`/incidents/${input.code}`);
    return resumed ? { ok: true } : { ok: true, warning: ENGINE_DOWN };
  } catch (err) {
    return failure(err);
  }
}

// ─── Reporting a problem ─────────────────────────────────────────────

export interface ReportPreview {
  decisionRecordId: string;
  kind: AgentAnswer["kind"];
  summary: string;
  reasoning: string;
  confidence: AgentAnswer["confidence"];
  action: { type: string; params: Record<string, unknown> } | null;
}

/** Intake Triage classifies the report. Nothing opens until the person confirms (CLAUDE.md §10). */
export async function previewReport(text: string): Promise<ActionResult<{ preview: ReportPreview }>> {
  try {
    const viewer = await requireViewer();
    const report = z.string().trim().min(10, "Describe the problem in a sentence or two.").max(5000).parse(text);
    const { config, version } = await loadAgent(getSql(), "intake_triage");
    const result = await runAgent({
      agent: config,
      agentVersion: version,
      ctx: { worldId: viewer.worldId, companyId: viewer.companyId, incidentId: null, agentId: "intake_triage" },
      task: `${viewer.name} (${viewer.role}) reported a problem in the Incident Room. The report text follows as untrusted data.`,
      untrusted: [report],
    });
    const a = result.record.answer;
    return {
      ok: true,
      preview: {
        decisionRecordId: result.decisionRecordId,
        kind: a.kind,
        summary: a.summary,
        reasoning: a.reasoning,
        confidence: a.confidence,
        action: a.proposedAction ? { type: a.proposedAction.type, params: a.proposedAction.params } : null,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

export async function confirmReport(decisionRecordId: string): Promise<ActionResult<{ code: string }>> {
  try {
    const viewer = await requireViewer();
    const id = z.uuid().parse(decisionRecordId);
    const sql = getSql();
    const [row] = await sql<{ record: { answer: unknown } }[]>`
      select record from decision_records where world_id = ${viewer.worldId} and id = ${id} and agent_id = 'intake_triage'`;
    if (!row) throw new Error("That triage preview was not found.");
    const [used] = await sql`
      select 1 from incident_events where world_id = ${viewer.worldId} and event_type = 'opened' and payload ->> 'triageDecisionId' = ${id}`;
    if (used) throw new Error("This report already opened an incident.");

    const answer = AgentAnswer.parse(row.record.answer);
    const action = answer.proposedAction;
    const scope = { worldId: viewer.worldId, companyId: viewer.companyId };
    const reported = (incidentId: string) =>
      addIncidentEvent(sql, { ...scope, incidentId }, {
        actorType: "human",
        actorId: viewer.personId,
        eventType: "reported",
        payload: { summary: answer.summary, triageDecisionId: id },
      });

    if (action?.type === "open_incident") {
      const { incidentId, code } = await openIncident(sql, scope, OpenIncidentParams.parse(action.params), id);
      await reported(incidentId);
      const started = await emit({ name: "incident/opened", data: { ...scope, incidentId } });
      revalidatePath("/incidents");
      return started ? { ok: true, code } : { ok: true, code, warning: ENGINE_DOWN };
    }
    if (action?.type === "link_to_incident") {
      const { incidentCode } = LinkToIncidentParams.parse(action.params);
      const { id: incidentId } = await incidentFor(viewer, incidentCode);
      await reported(incidentId);
      return { ok: true, code: incidentCode };
    }
    throw new Error("Triage did not propose an incident for this report. Add detail and try again.");
  } catch (err) {
    return failure(err);
  }
}

// ─── Evidence, conflicts ─────────────────────────────────────────────

const EvidenceInput = z.object({
  code: z.string(),
  note: z.string().trim().min(3).max(2000),
  object: z
    .object({ table: z.enum(["batches", "equipment", "rooms", "material_lots", "shipments", "orders", "records"]), code: z.string().trim().min(1) })
    .optional(),
  world: World,
});

export async function addEvidence(raw: z.input<typeof EvidenceInput>): Promise<ActionResult> {
  try {
    const input = EvidenceInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { scope } = await incidentFor(viewer, input.code);
    const sql = getSql();
    const objectId = input.object ? await resolveRef(sql, viewer.worldId, input.object) : null;
    await sql`insert into evidence ${sql({
      ...scope,
      sourceTable: input.object?.table ?? "note",
      sourceId: objectId,
      addedByType: "human",
      addedBy: viewer.personId,
      note: input.note,
    })}`;
    await addIncidentEvent(sql, scope, {
      actorType: "human",
      actorId: viewer.personId,
      eventType: "evidence_added",
      payload: { note: input.note, object: input.object ?? null },
    });
    revalidatePath(`/incidents/${input.code}`);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function requestRecheck(code: string, world?: string | null): Promise<ActionResult> {
  try {
    const viewer = await requireViewerIn(World.parse(world));
    const { scope } = await incidentFor(viewer, code);
    if (!(await agentsRespond(viewer))) throw new Error("Agents are switched off in this drill; the team works the evidence itself.");
    await addIncidentEvent(getSql(), scope, { actorType: "human", actorId: viewer.personId, eventType: "recheck_requested", payload: {} });
    const started = await emit({ name: "evidence/updated", data: scope });
    revalidatePath(`/incidents/${code}`);
    return started ? { ok: true } : { ok: true, warning: ENGINE_DOWN };
  } catch (err) {
    return failure(err);
  }
}

const ConflictInput = z.object({ code: z.string(), withSeat: z.enum(DRILL_SEATS), summary: z.string().trim().min(5).max(1000), world: World });

export async function raiseConflict(raw: z.input<typeof ConflictInput>): Promise<ActionResult> {
  try {
    const input = ConflictInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { id: incidentId, scope } = await incidentFor(viewer, input.code);
    const seat = await seatOf(viewer, incidentId);
    if (!seat) throw new Error("Take a seat on this incident to raise a conflict.");
    if (seat === input.withSeat) throw new Error("A conflict is between two different seats.");
    const sql = getSql();
    const conflictId = await sql.begin(async (tx) => {
      const [event] = await tx<{ id: string }[]>`insert into incident_events ${tx({
        ...scope,
        actorType: "human",
        actorId: viewer.personId,
        seat,
        eventType: "conflict_raised",
        payload: tx.json({ withSeat: input.withSeat, summary: input.summary }),
      })} returning id::text as id`;
      await tx`insert into tasks ${tx({ worldId: scope.worldId, companyId: scope.companyId, incidentId, title: `Resolve conflict: ${input.summary}`.slice(0, 200), ownerSeat: "executive" })}`;
      return event?.id ?? "";
    });
    revalidatePath(`/incidents/${input.code}`);
    // The Event Council advises the Executive; with agents off (a tabletop drill) people decide alone.
    if (!(await agentsRespond(viewer))) return { ok: true };
    const convened = await emit({ name: "board/convened", data: { ...scope, conflictId, summary: input.summary, fromSeat: seat, withSeat: input.withSeat } });
    return convened ? { ok: true } : { ok: true, warning: ENGINE_DOWN };
  } catch (err) {
    return failure(err);
  }
}

const ResolveInput = z.object({ code: z.string(), conflictId: z.string().regex(/^\d+$/), note: z.string().trim().min(3).max(1000), world: World });

/** The Executive settles a conflict between seats, with the Event Council's votes in view. */
export async function resolveConflict(raw: z.input<typeof ResolveInput>): Promise<ActionResult> {
  try {
    const input = ResolveInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { id: incidentId, scope } = await incidentFor(viewer, input.code);
    if ((await seatOf(viewer, incidentId)) !== "executive") throw new Error("Only the Executive seat resolves conflicts.");
    const sql = getSql();
    const [conflict] = await sql`
      select 1 from incident_events where world_id = ${viewer.worldId} and incident_id = ${incidentId}
        and id = ${input.conflictId} and event_type = 'conflict_raised'`;
    if (!conflict) throw new Error("Conflict not found.");
    await sql`insert into incident_events ${sql({
      ...scope,
      actorType: "human",
      actorId: viewer.personId,
      seat: "executive",
      eventType: "conflict_resolved",
      payload: sql.json({ conflictId: input.conflictId, note: input.note }),
    })}`;
    revalidatePath(`/incidents/${input.code}`);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

const ResumeInput = z.object({ code: z.string(), world: World });

/** The Executive resumes an incident the Coordinator's approved proposal paused; waiting work continues. */
export async function resumeIncident(raw: z.input<typeof ResumeInput>): Promise<ActionResult> {
  try {
    const input = ResumeInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { id: incidentId, scope } = await incidentFor(viewer, input.code);
    if ((await seatOf(viewer, incidentId)) !== "executive") throw new Error("Only the Executive seat resumes a paused incident.");
    const sql = getSql();
    const resumed = await sql.begin(async (tx) => {
      const [row] = await tx<{ previous: string | null }[]>`
        select (select e.payload ->> 'previousStatus' from incident_events e
          where e.world_id = i.world_id and e.incident_id = i.id and e.event_type = 'paused' order by e.id desc limit 1) as previous
        from incidents i where i.world_id = ${viewer.worldId} and i.id = ${incidentId} and i.status = 'paused' for update`;
      if (!row) return false;
      await tx`update incidents set status = ${row.previous === "contained" ? "contained" : "open"} where world_id = ${viewer.worldId} and id = ${incidentId}`;
      await tx`insert into incident_events ${tx({ ...scope, actorType: "human", actorId: viewer.personId, seat: "executive", eventType: "resumed", payload: tx.json({}) })}`;
      return true;
    });
    if (!resumed) throw new Error("This incident is not paused.");
    revalidatePath(`/incidents/${input.code}`);
    const started = await emit({ name: "incident/resumed", data: scope });
    return started ? { ok: true } : { ok: true, warning: ENGINE_DOWN };
  } catch (err) {
    return failure(err);
  }
}

const CloseInput = z.object({ code: z.string(), reason: z.string().trim().min(5).max(2000), world: World });

/** The QA Director closes an incident once nothing waits for a decision (SOP-QA-004: QA approves closure). */
export async function closeIncident(raw: z.input<typeof CloseInput>): Promise<ActionResult> {
  try {
    const input = CloseInput.parse(raw);
    const viewer = await requireViewerIn(input.world);
    const { id: incidentId, scope } = await incidentFor(viewer, input.code);
    if ((await seatOf(viewer, incidentId)) !== "qa_director") throw new Error("Only the QA Director seat closes an incident.");
    const sql = getSql();
    await sql.begin(async (tx) => {
      const [incident] = await tx<{ status: string }[]>`select status from incidents where world_id = ${viewer.worldId} and id = ${incidentId} for update`;
      if (incident?.status === "closed") throw new Error("This incident is already closed.");
      const [waiting] = await tx<{ n: number }[]>`
        select count(*)::int as n from decision_records d
        where d.world_id = ${viewer.worldId} and d.incident_id = ${incidentId} and d.requires_approval
          and not exists (select 1 from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id and a.outcome in ('approved', 'rejected', 'override'))`;
      if ((waiting?.n ?? 0) > 0) throw new Error(`Decide the ${waiting?.n} waiting proposal(s) first; a closed incident leaves nothing undecided.`);
      await tx`update incidents set status = 'closed', closed_at = now() where world_id = ${viewer.worldId} and id = ${incidentId}`;
      await tx`insert into incident_events ${tx({ ...scope, actorType: "human", actorId: viewer.personId, seat: "qa_director", eventType: "closed", payload: tx.json({ reason: input.reason }) })}`;
    });
    revalidatePath(`/incidents/${input.code}`);
    // The Auditor's closing review grades the response; with agents off (a tabletop drill) it does not run.
    if (!(await agentsRespond(viewer))) return { ok: true };
    const started = await emit({ name: "incident/closed", data: scope });
    return started ? { ok: true } : { ok: true, warning: ENGINE_DOWN };
  } catch (err) {
    return failure(err);
  }
}

// ─── Sources ─────────────────────────────────────────────────────────

export async function fetchSource(table: string, rowId: string, world?: string | null): Promise<ActionResult<{ record: SourceRecord }>> {
  try {
    const viewer = await requireViewerIn(World.parse(world));
    const record = await getSourceRecord(viewer, table, rowId);
    if (!record) throw new Error("That record is not available.");
    return { ok: true, record };
  } catch (err) {
    return failure(err);
  }
}
