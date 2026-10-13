/**
 * Orders and testing chains (Phase 7).
 *
 *   order/received → Order Desk (checks it) → order/urgent when code judges it urgent → Scheduler
 *   challenge/raised → Trial Runner (if activated): a confirm/rule-out test for the QA Director
 *
 * Orders live outside incidents, so these records have no incident; the Orders page shows them.
 */
import "server-only";
import { getInventoryPosition } from "@/db/inventory";
import { isUrgent } from "@/logistics/orders";
import { worldNow } from "@/regulatory/deadlines";
import { approvalRequest, decide, incidentScope, isActive, sqlFor, type Handler, type NamedHandler } from "./agent-steps";
import { ChallengeRaised, OrderReceived, OrderUrgent } from "./events";
import { describeIncident, firstTime } from "./incidents";

const checkOrder: Handler = async (run, data) => {
  const e = OrderReceived.parse(data);
  const scope = { worldId: e.worldId, companyId: e.companyId, incidentId: null };
  const sql = sqlFor();
  // Urgency is a rule (priority, due time, coverage), so code decides it before the agent explains.
  const facts = await run("order-facts", async () => {
    const [order] = await sql<{ orderCode: string; priority: string; dueAt: Date; quantity: number; destination: string }[]>`
      select o.order_code, o.priority, o.due_at, o.quantity, l.name as destination
      from orders o join locations l on l.world_id = o.world_id and l.id = o.destination_id
      where o.world_id = ${e.worldId} and o.id = ${e.orderId}`;
    if (!order) throw new Error(`Order ${e.orderId} not found`);
    const covered = (await getInventoryPosition(sql, e.worldId)).orders.find((o) => o.orderCode === order.orderCode)?.covered ?? false;
    return { ...order, urgent: isUrgent(order, covered, await worldNow(sql, e.worldId)), dueAt: order.dueAt.toISOString() };
  });
  const check = await run("order-desk", () =>
    decide(
      sql,
      "order_desk",
      scope,
      `New order ${facts.orderCode}: ${facts.quantity} units for ${facts.destination}, ${facts.priority} priority, due ${facts.dueAt}. Code marked it ${facts.urgent ? "URGENT (the Scheduler will plan it)" : "not urgent"}. Check it.`,
    ),
  );
  return facts.urgent ? [{ name: "order/urgent", data: { worldId: e.worldId, companyId: e.companyId, orderCode: facts.orderCode, orderDeskDecisionId: check.decisionRecordId } }] : [];
};

const planUrgentOrder: Handler = async (run, data) => {
  const e = OrderUrgent.parse(data);
  const sql = sqlFor();
  await run("scheduler", () =>
    decide(sql, "scheduler", { worldId: e.worldId, companyId: e.companyId, incidentId: null }, `Order ${e.orderCode} is urgent (Order Desk check: decision ${e.orderDeskDecisionId}). Plan its earliest realistic supply.`),
  );
  return [];
};

const designTest: Handler = async (run, data) => {
  const e = ChallengeRaised.parse(data);
  const scope = incidentScope(e);
  const sql = sqlFor();
  if (!(await isActive(run, sql, scope, "trial_runner", "check-trial-runner"))) return [];
  if (!(await run("once", () => firstTime(sql, scope, `trial_runner:${e.challengesDecisionId}`)))) return [];
  const description = await run("describe-incident", () => describeIncident(sql, e.worldId, e.incidentId));
  const test = await run("trial-runner", () =>
    decide(sql, "trial_runner", scope, `${description} The root cause proposed in decision ${e.challengesDecisionId} was challenged in decision ${e.decisionRecordId}. Design a test that tells them apart.`),
  );
  return approvalRequest(run, sql, scope, test, "trial-test");
};

export const orderHandlers: Readonly<Record<string, readonly NamedHandler[]>> = {
  "order/received": [{ id: "order-desk", handle: checkOrder }],
  "order/urgent": [{ id: "schedule-urgent-order", handle: planUrgentOrder }],
  "challenge/raised": [{ id: "trial-runner", handle: designTest }],
};
