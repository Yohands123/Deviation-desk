import { AiMarker, cx, Mono, Panel, timeLabel } from "@/components/ui";
import { requireViewer } from "@/incident-room/viewer";
import { getOrdersPage, type OrderRowView } from "@/orders/queries";
import { WorldRealtime } from "@/components/world-realtime";
import { LogOrderForm } from "./orders-client";

const PRIORITY_LABEL: Record<string, string> = { routine: "Routine", high: "High", patient_critical: "Patient-critical" };
const AGENT_LABEL = { order_desk: "Order Desk", scheduler: "Scheduler" } as const;

function Coverage({ order }: { order: OrderRowView }) {
  if (order.status === "delivered" || order.status === "cancelled") return <span className="text-xs capitalize text-muted">{order.status}</span>;
  if (order.covered === null) return <span className="text-xs text-muted">Not yet planned</span>;
  return <span className={cx("text-xs", order.covered ? "text-ok" : "text-at-risk-text")}>{order.covered ? "Covered by a shipment" : "No supply yet"}</span>;
}

export default async function OrdersPage() {
  const viewer = await requireViewer();
  const page = await getOrdersPage(viewer);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <WorldRealtime worldId={viewer.worldId} />
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted">
          The Order Desk checks every new order against stock and open incidents. Urgent ones go to the Scheduler, which plans the earliest realistic supply with the optimizer.
        </p>
      </div>

      <Panel title="Log an order">
        <LogOrderForm products={page.products} destinations={page.destinations} />
      </Panel>

      <ul className="divide-y divide-line rounded-lg border border-line bg-panel" aria-label="Orders">
        {page.orders.map((o) => (
          <li key={o.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Mono>{o.orderCode}</Mono>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{o.quantity.toLocaleString("en-CA")} units</span> <span className="text-muted">for {o.destination}</span>
              </span>
              <span className={cx("text-xs", o.priority === "patient_critical" ? "font-medium text-critical-text" : "text-muted")}>{PRIORITY_LABEL[o.priority] ?? o.priority}</span>
              <Coverage order={o} />
              <time className="font-mono text-xs text-muted" dateTime={o.dueAt}>
                Due {timeLabel(o.dueAt)}
              </time>
            </div>
            {o.loggedBy && <p className="mt-0.5 text-xs text-muted">Logged by {o.loggedBy}</p>}
            {o.findings.length > 0 && (
              <div className="mt-2 space-y-2">
                {o.findings.map((f) => (
                  <div key={f.decisionRecordId} className="rounded-md bg-ai-tint p-3 text-sm">
                    <AiMarker label={AGENT_LABEL[f.agent]} />
                    <p className="mt-1">{f.summary}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted">Details{f.alternatives.length > 0 ? " and options" : ""}</summary>
                      <p className="mt-1 whitespace-pre-wrap">{f.reasoning}</p>
                      {f.alternatives.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {f.alternatives.map((a) => (
                            <li key={a.summary}>
                              {a.summary} <span className="text-muted">({a.whyNotChosen})</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
