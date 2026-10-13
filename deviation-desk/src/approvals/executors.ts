/**
 * Carries out an approved proposal on the twin. The only code path that changes object status
 * because of an agent's proposal, and it runs only after re-reading an approved `approvals` row
 * (CLAUDE.md principle 1). Every change stays inside the decision's world. Running twice is safe:
 * an action already executed for a decision is not repeated (workflow retries).
 */
import type postgres from "postgres";
import {
  AcceptRootCauseParams,
  ConfirmObligationParams,
  ContactSupplierParams,
  HoldBatchParams,
  HoldShipmentParams,
  MessageParams,
  PauseIncidentParams,
  RerouteSupplyParams,
  RunTestParams,
} from "@/agents/action-params";
import { queueMessage, resolveRecipients, type Audience } from "@/comms/outbox";
import { awarenessAt, dueAt, worldNow } from "@/regulatory/deadlines";
import { AgentAnswer } from "@/agents/contract";
import type { Sql, TransactionSql } from "@/db/client";
import type { Emitted } from "@/workflows/events";
import { ExecutionFailed } from "./execution-failed";

export { ExecutionFailed };

interface Context {
  worldId: string;
  companyId: string;
  incidentId: string;
  decisionRecordId: string;
  approvalId: string;
}

type Executor = (tx: TransactionSql, ctx: Context, params: Record<string, unknown>) => Promise<{ result: Record<string, unknown>; emit: Emitted[] }>;

const scope = (c: Context) => ({ worldId: c.worldId, companyId: c.companyId, incidentId: c.incidentId });

const holdBatch: Executor = async (tx, c, raw) => {
  const p = HoldBatchParams.parse(raw);
  const batches = await tx<{ id: string; batchCode: string }[]>`
    update batches set status = 'quarantined'
    where world_id = ${c.worldId} and batch_code in ${tx(p.batches)} and status <> 'rejected'
    returning id, batch_code`;
  const lots = batches.length
    ? await tx`update inventory_lots set on_hold = true where world_id = ${c.worldId} and batch_id in ${tx(batches.map((b) => b.id))} returning id`
    : [];
  const held = batches.map((b) => b.batchCode);
  return {
    result: { held, notFound: p.batches.filter((code) => !held.includes(code)), inventoryLotsOnHold: lots.length },
    emit: [{ name: "hold/approved", data: { ...scope(c), decisionRecordId: c.decisionRecordId, kind: "batches", codes: held } }],
  };
};

const holdShipment: Executor = async (tx, c, raw) => {
  const p = HoldShipmentParams.parse(raw);
  // Delivered shipments cannot be held; they stay as they are and are reported.
  const rows = await tx<{ shipmentCode: string }[]>`
    update shipments set status = 'held'
    where world_id = ${c.worldId} and shipment_code in ${tx(p.shipments)} and status in ('planned', 'at_dock', 'in_transit')
    returning shipment_code`;
  const held = rows.map((r) => r.shipmentCode);
  return {
    result: { held, notHeld: p.shipments.filter((code) => !held.includes(code)) },
    emit: [{ name: "hold/approved", data: { ...scope(c), decisionRecordId: c.decisionRecordId, kind: "shipments", codes: held } }],
  };
};

const acceptRootCause: Executor = async (_tx, c, raw) => {
  const p = AcceptRootCauseParams.parse(raw);
  return {
    result: { cause: p.cause, causeObject: p.causeObject ?? null },
    emit: [{ name: "root_cause/accepted", data: { ...scope(c), decisionRecordId: c.decisionRecordId } }],
  };
};

/** Creates a planned shipment per source location, taking the oldest released, unheld stock first. */
const rerouteSupply: Executor = async (tx, c, raw) => {
  const p = RerouteSupplyParams.parse(raw);
  const [order] = await tx<{ id: string; destinationId: string; storageCondition: string }[]>`
    select o.id, o.destination_id, pr.storage_condition from orders o
    join products pr on pr.world_id = o.world_id and pr.id = o.product_id
    where o.world_id = ${c.worldId} and o.order_code = ${p.orderCode}`;
  if (!order) throw new Error(`Order ${p.orderCode} not found`);

  const created: Array<{ shipment: string; from: string; quantity: number }> = [];
  for (const allocation of p.allocations) {
    const lots = await tx<{ id: string; locationId: string; free: number }[]>`
      select i.id, i.location_id,
        (i.quantity - coalesce((select sum(si.quantity) from shipment_items si
          join shipments s on s.world_id = si.world_id and s.id = si.shipment_id
          where si.world_id = i.world_id and si.inventory_lot_id = i.id and s.status in ('planned', 'at_dock')), 0))::int as free
      from inventory_lots i
      join batches b on b.world_id = i.world_id and b.id = i.batch_id
      join locations l on l.world_id = i.world_id and l.id = i.location_id
      where i.world_id = ${c.worldId} and l.name = ${allocation.location}
        and b.status = 'released' and not i.on_hold
      order by b.produced_at, i.id
      for update of i`;
    let remaining = allocation.quantity;
    const items: Array<{ inventoryLotId: string; quantity: number }> = [];
    for (const lot of lots) {
      if (remaining === 0) break;
      const take = Math.min(lot.free, remaining);
      if (take > 0) items.push({ inventoryLotId: lot.id, quantity: take });
      remaining -= take;
    }
    const origin = lots[0]?.locationId;
    if (remaining > 0 || !origin) {
      throw new ExecutionFailed(`${allocation.location} no longer has ${allocation.quantity} units free; the plan is out of date.`);
    }

    const [{ next } = { next: 1 }] = await tx<{ next: number }[]>`
      select coalesce(max(substring(shipment_code from '^SH-(\\d+)$')::int), 0) + 1 as next
      from shipments where world_id = ${c.worldId}`;
    const shipmentCode = `SH-${next}`;
    const [shipment] = await tx<{ id: string }[]>`
      insert into shipments ${tx({
        worldId: c.worldId,
        companyId: c.companyId,
        shipmentCode,
        originId: origin,
        destinationId: order.destinationId,
        orderId: order.id,
        status: "planned",
        storageCondition: order.storageCondition,
      })}
      returning id`;
    if (!shipment) throw new Error("Failed to create shipment");
    await tx`insert into shipment_items ${tx(items.map((i) => ({ worldId: c.worldId, companyId: c.companyId, shipmentId: shipment.id, ...i })))}`;
    created.push({ shipment: shipmentCode, from: allocation.location, quantity: allocation.quantity });
  }
  await tx`update orders set status = 'allocated' where world_id = ${c.worldId} and id = ${order.id}`;
  return { result: { orderCode: p.orderCode, shipments: created }, emit: [] };
};

// ─── Messages (src/comms/outbox.ts) ───

const messageCtx = (c: Context) => ({ ...scope(c), decisionRecordId: c.decisionRecordId, approvalId: c.approvalId });

/** The outbox delivers ready messages; drill messages stay recorded. */
const deliveryEvents = (worldId: string, queued: { id: string; status: string }): Emitted[] =>
  queued.status === "ready" ? [{ name: "outbound/ready", data: { worldId, messageId: queued.id } }] : [];

const contactSupplier: Executor = async (tx, c, raw) => {
  const p = ContactSupplierParams.parse(raw);
  const recipients = await resolveRecipients(tx, c.worldId, [p.supplier], ["supplier"]);
  const queued = await queueMessage(tx, messageCtx(c), {
    actionType: "contact_supplier",
    audience: "supplier",
    recipients,
    subject: `Request about ${p.material}`,
    body: p.message,
  });
  return { result: { messageId: queued.id, delivery: queued.status, to: recipients.map((r) => r.name) }, emit: deliveryEvents(c.worldId, queued) };
};

/** A drafted message to a known audience: resolve the recipients, then queue it exactly as approved. */
const sendMessage =
  (actionType: string, audience: Audience): Executor =>
  async (tx, c, raw) => {
    const p = MessageParams.parse(raw);
    const recipients = await resolveRecipients(tx, c.worldId, p.to, [audience]);
    const queued = await queueMessage(tx, messageCtx(c), { actionType, audience, recipients, subject: p.subject, body: p.message });
    return { result: { messageId: queued.id, delivery: queued.status, to: recipients.map((r) => r.name) }, emit: deliveryEvents(c.worldId, queued) };
  };

/** A regulatory submission fulfils a confirmed obligation and closes its task. */
const submitNotification: Executor = async (tx, c, raw) => {
  const p = MessageParams.parse(raw);
  if (!p.ruleCode) throw new ExecutionFailed("A submission must name the rule it fulfils.");
  const [obligation] = await tx<{ id: string; taskId: string | null; submittedMessageId: string | null }[]>`
    select o.id, o.task_id, o.submitted_message_id from regulatory_obligations o
    join regulatory_rules r on r.world_id = o.world_id and r.id = o.rule_id
    where o.world_id = ${c.worldId} and o.incident_id = ${c.incidentId} and r.code = ${p.ruleCode}`;
  if (!obligation) throw new ExecutionFailed(`Regulatory Affairs has not confirmed ${p.ruleCode} for this incident.`);
  if (obligation.submittedMessageId) throw new ExecutionFailed(`A submission for ${p.ruleCode} was already approved.`);
  const recipients = await resolveRecipients(tx, c.worldId, p.to, ["regulator"]);
  const queued = await queueMessage(tx, messageCtx(c), { actionType: "submit_notification", audience: "regulator", recipients, subject: p.subject, body: p.message });
  await tx`update regulatory_obligations set submitted_message_id = ${queued.id} where world_id = ${c.worldId} and id = ${obligation.id}`;
  if (obligation.taskId) await tx`update tasks set status = 'done' where world_id = ${c.worldId} and id = ${obligation.taskId}`;
  return { result: { messageId: queued.id, delivery: queued.status, ruleCode: p.ruleCode }, emit: deliveryEvents(c.worldId, queued) };
};

// ─── Regulatory obligations ───

/** Regulatory Affairs confirmed a rule applies: record it, compute the deadline, open a task. */
const confirmReportingObligation: Executor = async (tx, c, raw) => {
  const p = ConfirmObligationParams.parse(raw);
  const [rule] = await tx<{ id: string; code: string; title: string; authority: string; deadlineHours: number; clockStarts: "awareness" | "confirmation" }[]>`
    select id, code, title, authority, deadline_hours, clock_starts from regulatory_rules where world_id = ${c.worldId} and code = ${p.ruleCode}`;
  if (!rule) throw new ExecutionFailed(`There is no rule ${p.ruleCode} in the regulatory library.`);
  const [existing] = await tx`select 1 from regulatory_obligations where world_id = ${c.worldId} and incident_id = ${c.incidentId} and rule_id = ${rule.id}`;
  if (existing) throw new ExecutionFailed(`${rule.code} is already confirmed for this incident.`);

  const clockStartedAt = rule.clockStarts === "awareness" ? await awarenessAt(tx, c.worldId, c.incidentId) : await worldNow(tx, c.worldId);
  const due = dueAt(clockStartedAt, rule.deadlineHours);
  const [task] = await tx<{ id: string }[]>`
    insert into tasks ${tx({ ...scope(c), title: `Submit ${rule.code} ${rule.title} to ${rule.authority}`.slice(0, 200), ownerSeat: "regulatory_affairs", dueAt: due })}
    returning id`;
  const [obligation] = await tx<{ id: string }[]>`
    insert into regulatory_obligations ${tx({
      ...scope(c),
      ruleId: rule.id,
      decisionRecordId: c.decisionRecordId,
      approvalId: c.approvalId,
      clockStartedAt,
      dueAt: due,
      taskId: task?.id ?? null,
    })}
    returning id`;
  if (!obligation) throw new Error("Failed to record the obligation");
  return {
    result: { ruleCode: rule.code, clockStartedAt: clockStartedAt.toISOString(), dueAt: due.toISOString() },
    emit: [{ name: "obligation/confirmed", data: { ...scope(c), obligationId: obligation.id, ruleCode: rule.code } }],
  };
};

// ─── Investigation ───

/** QA approved a confirm/rule-out test: it becomes a QA task, due when the test can finish. */
const runTest: Executor = async (tx, c, raw) => {
  const p = RunTestParams.parse(raw);
  const due = new Date((await worldNow(tx, c.worldId)).getTime() + p.durationHours * 3_600_000);
  const [task] = await tx<{ id: string }[]>`
    insert into tasks ${tx({ ...scope(c), title: `Run test: ${p.test}`.slice(0, 200), ownerSeat: "qa_director", dueAt: due })}
    returning id`;
  return { result: { taskId: task?.id ?? null, test: p.test, targets: p.targets, dueAt: due.toISOString() }, emit: [] };
};

// ─── Coordination ───

/** Pauses another (or this) incident's agent work; handlers wait until someone resumes it. */
const pauseIncident: Executor = async (tx, c, raw) => {
  const p = PauseIncidentParams.parse(raw);
  const [target] = await tx<{ id: string; status: string }[]>`
    select id, status from incidents where world_id = ${c.worldId} and code = ${p.incidentCode} for update`;
  if (!target) throw new ExecutionFailed(`There is no incident ${p.incidentCode}.`);
  if (target.status !== "open" && target.status !== "contained") throw new ExecutionFailed(`${p.incidentCode} is ${target.status}; only open work can be paused.`);
  await tx`update incidents set status = 'paused' where world_id = ${c.worldId} and id = ${target.id}`;
  await tx`insert into incident_events ${tx({
    worldId: c.worldId,
    companyId: c.companyId,
    incidentId: target.id,
    actorType: "system",
    actorId: "executor",
    eventType: "paused",
    payload: tx.json({ reason: p.reason, decisionRecordId: c.decisionRecordId, approvalId: c.approvalId, previousStatus: target.status }),
  })}`;
  return { result: { paused: p.incidentCode, previousStatus: target.status }, emit: [] };
};

const EXECUTORS: Record<string, Executor> = {
  hold_batch: holdBatch,
  hold_shipment: holdShipment,
  accept_root_cause: acceptRootCause,
  reroute_supply: rerouteSupply,
  contact_supplier: contactSupplier,
  notify_customer: sendMessage("notify_customer", "customer"),
  notify_trial_site: sendMessage("notify_trial_site", "trial_site"),
  notify_staff: sendMessage("notify_staff", "internal"),
  submit_notification: submitNotification,
  confirm_reporting_obligation: confirmReportingObligation,
  pause_incident: pauseIncident,
  run_test: runTest,
};


const asJson = (value: Record<string, unknown>) => value as postgres.JSONValue;

export interface ExecutionOutcome {
  status: "executed" | "already_executed" | "not_automated" | "failed";
  result: Record<string, unknown>;
  emit: Emitted[];
}

export async function executeApproved(sql: Sql, worldId: string, decisionRecordId: string): Promise<ExecutionOutcome> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`execute:${decisionRecordId}`}))`;

    const [row] = await tx<{ record: { answer: unknown }; incidentId: string | null; companyId: string; approvalId: string | null }[]>`
      select d.record, d.incident_id, d.company_id,
        (select a.id from approvals a where a.world_id = d.world_id and a.decision_record_id = d.id and a.outcome = 'approved'
          order by a.created_at desc limit 1) as approval_id
      from decision_records d where d.world_id = ${worldId} and d.id = ${decisionRecordId}`;
    if (!row) throw new Error("Decision record not found in this world.");
    // Principle 1: no approval row, no action.
    if (!row.approvalId) throw new Error(`Decision ${decisionRecordId} has no approval; refusing to execute.`);
    if (!row.incidentId) throw new Error("Approved decisions belong to an incident.");

    const [done] = await tx`
      select 1 from incident_events
      where world_id = ${worldId} and incident_id = ${row.incidentId}
        and event_type in ('action_executed', 'action_failed', 'action_not_automated')
        and payload ->> 'decisionRecordId' = ${decisionRecordId}`;
    if (done) return { status: "already_executed", result: {}, emit: [] };

    const answer = AgentAnswer.parse(row.record.answer);
    const action = answer.proposedAction;
    if (!action) throw new Error("Approved decision has no action.");
    const ctx: Context = { worldId, companyId: row.companyId, incidentId: row.incidentId, decisionRecordId, approvalId: row.approvalId };

    const record = (eventType: string, payload: Record<string, unknown>) =>
      tx`insert into incident_events ${tx({
        worldId,
        companyId: row.companyId,
        incidentId: ctx.incidentId,
        actorType: "system",
        actorId: "executor",
        eventType,
        payload: tx.json(asJson({ decisionRecordId, approvalId: ctx.approvalId, actionType: action.type, ...payload })),
      })}`;

    const executor = EXECUTORS[action.type];
    if (!executor) {
      await record("action_not_automated", { note: "Approved; carry this out by hand." });
      return { status: "not_automated", result: {}, emit: [] };
    }
    try {
      // A savepoint so a failed execution leaves the twin untouched but still records the failure.
      const { result, emit } = await tx.savepoint((sp) => executor(sp, ctx, action.params));
      await record("action_executed", { result });
      return { status: "executed", result, emit };
    } catch (err) {
      if (!(err instanceof ExecutionFailed)) throw err;
      await record("action_failed", { reason: err.message });
      return { status: "failed", result: { reason: err.message }, emit: [] };
    }
  });
}
