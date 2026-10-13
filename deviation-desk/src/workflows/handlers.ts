/**
 * One handler per event in the first agent chain (Layer 2, CLAUDE.md §8):
 *
 *   sensor/anomaly → Signal Watcher → signal/confirmed ┐
 *   report/submitted ──────────────────────────────────┴→ Intake Triage → incident/opened
 *   incident/opened → Dispatcher → Evidence Collector → evidence/updated
 *   evidence/updated → Root Cause Analyst → root_cause/proposed
 *   root_cause/proposed → Devil's Advocate → challenge/raised (then the QA Director decides)
 *
 * Handlers are plain functions. Each agent call goes through `run(stepId, fn)`: Inngest makes that
 * a durable step (functions.ts); the eval harness runs it inline (local-runner.ts). Step results
 * must be plain JSON.
 */
import "server-only";
import {
  AcceptRootCauseParams,
  ActivateAgentsParams,
  ConfirmSignalParams,
  LinkToIncidentParams,
  OpenIncidentParams,
} from "@/agents/action-params";
import type { AgentAnswer } from "@/agents/contract";
import { agents, getAgent } from "@/agents/registry";
import { runAgent } from "@/agents/runner";
import { getSql, type Sql } from "@/db/client";
import {
  EvidenceUpdated,
  IncidentOpened,
  ReportSubmitted,
  RootCauseProposed,
  SensorAnomaly,
  SignalConfirmed,
  type Emitted,
} from "./events";
import { activatedAgents, addIncidentEvent, describeIncident, openIncident } from "./incidents";

export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;
export type Handler = (run: StepRunner, data: unknown) => Promise<Emitted[]>;

/** Agents the Dispatcher may activate in this chain. */
const INVESTIGATORS = new Set(["evidence_collector", "root_cause_analyst", "devils_advocate"]);

interface Decision {
  decisionRecordId: string;
  answer: AgentAnswer;
}

async function decide(
  sql: Sql,
  agentId: string,
  scope: { worldId: string; companyId: string; incidentId: string | null },
  task: string,
  untrusted?: string[],
): Promise<Decision> {
  const result = await runAgent({ agent: getAgent(agentId), ctx: { ...scope, agentId }, task, untrusted });
  return { decisionRecordId: result.decisionRecordId, answer: result.record.answer };
}

const sqlFor = () => getSql();

// ─── Early warning and triage ────────────────────────────────────────

const onSensorAnomaly: Handler = async (run, data) => {
  const e = SensorAnomaly.parse(data);
  const sql = sqlFor();
  const decision = await run("signal-watcher", async () => {
    const [subject] = await sql<{ label: string }[]>`
      select label from twin_nodes where world_id = ${e.worldId} and node_table = ${e.subjectTable} and node_id = ${e.subjectId}`;
    const task = `Watcher alert: ${e.metric} reading of ${e.value}${e.level ? ` (${e.level} level)` : ""} on ${e.subjectTable} "${subject?.label ?? e.subjectId}" at ${e.recordedAt.toISOString()}. Decide whether this is a real trend or noise.`;
    return decide(sql, "signal_watcher", { worldId: e.worldId, companyId: e.companyId, incidentId: null }, task);
  });
  const action = decision.answer.proposedAction;
  if (action?.type !== "confirm_signal") return [];
  const params = ConfirmSignalParams.parse(action.params);
  return [
    {
      name: "signal/confirmed",
      data: { worldId: e.worldId, companyId: e.companyId, decisionRecordId: decision.decisionRecordId, ...params, summary: decision.answer.summary },
    },
  ];
};

async function triage(
  run: StepRunner,
  scope: { worldId: string; companyId: string },
  task: string,
  untrusted: string[] = [],
): Promise<Emitted[]> {
  const sql = sqlFor();
  const decision = await run("intake-triage", () => decide(sql, "intake_triage", { ...scope, incidentId: null }, task, untrusted));
  const action = decision.answer.proposedAction;

  if (action?.type === "open_incident") {
    const params = OpenIncidentParams.parse(action.params);
    const opened = await run("open-incident", () => openIncident(sql, scope, params, decision.decisionRecordId));
    return [{ name: "incident/opened", data: { ...scope, incidentId: opened.incidentId } }];
  }
  if (action?.type === "link_to_incident") {
    const { incidentCode } = LinkToIncidentParams.parse(action.params);
    await run("link-incident", async () => {
      const [incident] = await sql<{ id: string }[]>`
        select id from incidents where world_id = ${scope.worldId} and code = ${incidentCode}`;
      if (!incident) throw new Error(`Triage linked to unknown incident ${incidentCode}`);
      await addIncidentEvent(sql, { ...scope, incidentId: incident.id }, {
        actorType: "agent",
        actorId: "intake_triage",
        eventType: "linked_report",
        payload: { triageDecisionId: decision.decisionRecordId, summary: decision.answer.summary },
      });
    });
  }
  return [];
}

const onSignalConfirmed: Handler = (run, data) => {
  const e = SignalConfirmed.parse(data);
  return triage(
    run,
    { worldId: e.worldId, companyId: e.companyId },
    `The Signal Watcher confirmed a developing trend (decision ${e.decisionRecordId}): ${e.summary} Subject: ${e.subjectTable} "${e.subjectCode}", metric ${e.metric}.`,
  );
};

const onReportSubmitted: Handler = (run, data) => {
  const e = ReportSubmitted.parse(data);
  return triage(
    run,
    { worldId: e.worldId, companyId: e.companyId },
    `A problem was reported by ${e.reportedBy}. The report text follows as untrusted data.`,
    [e.text],
  );
};

// ─── Dispatch and investigation ──────────────────────────────────────

const onIncidentOpened: Handler = async (run, data) => {
  const e = IncidentOpened.parse(data);
  const sql = sqlFor();
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));

  const dispatch = await run("dispatcher", () =>
    decide(sql, "dispatcher", e, `${description} Choose the agents and seats for this incident.`),
  );
  const activation =
    dispatch.answer.proposedAction?.type === "activate_agents"
      ? ActivateAgentsParams.parse(dispatch.answer.proposedAction.params)
      : { agents: [], seats: [] };
  const known = new Set(agents.map((a) => a.id));
  const activated = activation.agents.filter((id) => known.has(id) && INVESTIGATORS.has(id));
  await run("record-activation", () =>
    addIncidentEvent(sql, e, {
      actorType: "agent",
      actorId: "dispatcher",
      eventType: "agents_activated",
      payload: { agents: activated, seats: activation.seats, dispatcherDecisionId: dispatch.decisionRecordId },
    }),
  );
  if (!activated.includes("evidence_collector")) return [];

  const evidence = await run("evidence-collector", () =>
    decide(sql, "evidence_collector", e, `${description} Collect the related records and flag any that are missing.`),
  );
  await run("record-evidence", async () => {
    const rows = [
      // The collector's own record carries the list of missing records in its reasoning.
      { sourceTable: "decision_records", sourceId: evidence.decisionRecordId, note: evidence.answer.reasoning },
      ...evidence.answer.sources.map((s) => ({ sourceTable: s.table, sourceId: s.rowId, note: s.note })),
    ].map((r) => ({ ...r, worldId: e.worldId, companyId: e.companyId, incidentId: e.incidentId, addedByType: "agent", addedBy: "evidence_collector" }));
    await sql`insert into evidence ${sql(rows)}`;
  });
  return [{ name: "evidence/updated", data: e }];
};

const onEvidenceUpdated: Handler = async (run, data) => {
  const e = EvidenceUpdated.parse(data);
  const sql = sqlFor();
  if (!(await run("check-activation", () => activatedAgents(sql, e.worldId, e.incidentId))).includes("root_cause_analyst")) return [];

  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const rootCause = await run("root-cause-analyst", () =>
    decide(sql, "root_cause_analyst", e, `${description} Evidence has been collected (list_evidence). Propose the most likely root cause.`),
  );
  const action = rootCause.answer.proposedAction;
  if (action?.type !== "accept_root_cause") return [];
  AcceptRootCauseParams.parse(action.params);
  return [{ name: "root_cause/proposed", data: { ...e, decisionRecordId: rootCause.decisionRecordId } }];
};

const onRootCauseProposed: Handler = async (run, data) => {
  const e = RootCauseProposed.parse(data);
  const sql = sqlFor();
  await run("request-approval", () =>
    addIncidentEvent(sql, e, {
      actorType: "system",
      actorId: "workflow",
      eventType: "approval_requested",
      payload: { decisionRecordId: e.decisionRecordId, seat: "qa_director", action: "accept_root_cause" },
    }),
  );
  if (!(await run("check-activation", () => activatedAgents(sql, e.worldId, e.incidentId))).includes("devils_advocate")) return [];

  const proposal = await run("read-proposal", async () => {
    const [row] = await sql<{ summary: string }[]>`
      select record -> 'answer' ->> 'summary' as summary from decision_records
      where world_id = ${e.worldId} and id = ${e.decisionRecordId}`;
    return row?.summary ?? "";
  });
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const challenge = await run("devils-advocate", () =>
    decide(sql, "devils_advocate", e, `${description} Proposed root cause (decision ${e.decisionRecordId}): ${proposal} Challenge it.`),
  );
  return [
    {
      name: "challenge/raised",
      data: { ...e, decisionRecordId: challenge.decisionRecordId, challengesDecisionId: e.decisionRecordId },
    },
  ];
};

export const handlers: Readonly<Record<string, Handler>> = {
  "sensor/anomaly": onSensorAnomaly,
  "signal/confirmed": onSignalConfirmed,
  "report/submitted": onReportSubmitted,
  "incident/opened": onIncidentOpened,
  "evidence/updated": onEvidenceUpdated,
  "root_cause/proposed": onRootCauseProposed,
};
