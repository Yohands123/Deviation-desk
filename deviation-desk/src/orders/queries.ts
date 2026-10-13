/**
 * Reads for the Orders page: orders in the viewer's live world with their coverage, and the Order
 * Desk's and Scheduler's latest findings for each.
 */
import "server-only";
import { AgentAnswer } from "@/agents/contract";
import { getSql } from "@/db/client";
import { getInventoryPosition } from "@/db/inventory";
import type { Viewer } from "@/incident-room/viewer";

export interface OrderFinding {
  decisionRecordId: string;
  agent: "order_desk" | "scheduler";
  summary: string;
  reasoning: string;
  alternatives: Array<{ summary: string; whyNotChosen: string }>;
  at: string;
}

export interface OrderRowView {
  id: string;
  orderCode: string;
  product: string;
  destination: string;
  quantity: number;
  dueAt: string;
  priority: string;
  status: string;
  /** Null when outside the 14-day planning horizon or already delivered. */
  covered: boolean | null;
  loggedBy: string | null;
  loggedAt: string | null;
  findings: OrderFinding[];
}

export interface OrdersPage {
  orders: OrderRowView[];
  products: Array<{ id: string; name: string }>;
  destinations: Array<{ id: string; name: string; kind: string }>;
}

export async function getOrdersPage(viewer: Viewer): Promise<OrdersPage> {
  const sql = getSql();
  const w = viewer.worldId;
  const rows = await sql<Array<Omit<OrderRowView, "dueAt" | "loggedAt" | "covered" | "findings"> & { dueAt: Date; loggedAt: Date | null }>>`
    select o.id, o.order_code, p.name as product, l.name as destination, o.quantity, o.due_at, o.priority, o.status, pe.name as logged_by, o.logged_at
    from orders o
    join products p on p.world_id = o.world_id and p.id = o.product_id
    join locations l on l.world_id = o.world_id and l.id = o.destination_id
    left join people pe on pe.world_id = o.world_id and pe.id = o.logged_by
    where o.world_id = ${w}
    order by o.status in ('delivered', 'cancelled'), o.due_at`;
  const coverage = new Map((await getInventoryPosition(sql, w)).orders.map((o) => [o.orderCode, o.covered]));
  const records = await sql<{ id: string; agentId: "order_desk" | "scheduler"; record: { answer: unknown }; createdAt: Date }[]>`
    select id, agent_id, record, created_at from decision_records
    where world_id = ${w} and incident_id is null and agent_id in ('order_desk', 'scheduler')
    order by created_at`;
  const findings = new Map<string, OrderFinding[]>();
  for (const r of records) {
    const a = AgentAnswer.safeParse(r.record.answer);
    const code = a.success ? a.data.proposedAction?.params.orderCode : undefined;
    if (!a.success || typeof code !== "string") continue;
    findings.set(code, [
      ...(findings.get(code) ?? []),
      { decisionRecordId: r.id, agent: r.agentId, summary: a.data.summary, reasoning: a.data.reasoning, alternatives: a.data.alternatives, at: r.createdAt.toISOString() },
    ]);
  }
  const products = await sql<{ id: string; name: string }[]>`select id, name from products where world_id = ${w} order by name`;
  const destinations = await sql<{ id: string; name: string; kind: string }[]>`
    select id, name, kind from locations where world_id = ${w} and kind in ('customer', 'trial_site') order by kind, name`;
  return {
    orders: rows.map((o) => ({
      ...o,
      dueAt: o.dueAt.toISOString(),
      loggedAt: o.loggedAt?.toISOString() ?? null,
      covered: coverage.get(o.orderCode) ?? null,
      findings: findings.get(o.orderCode) ?? [],
    })),
    products,
    destinations,
  };
}
