"use server";
/** Logging an order from the Orders page. The Order Desk checks it; urgent orders go to the Scheduler. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSql } from "@/db/client";
import { requireViewer } from "@/incident-room/viewer";
import { logOrder } from "@/logistics/orders";
import { emit } from "@/workflows/emit";

type Result = { ok: true; orderCode: string; warning?: string } | { ok: false; error: string };

const Input = z.object({
  productId: z.uuid(),
  destinationId: z.uuid(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  dueAt: z.coerce.date(),
  priority: z.enum(["routine", "high", "patient_critical"]),
});

export async function logOrderAction(raw: z.input<typeof Input>): Promise<Result> {
  try {
    const input = Input.parse(raw);
    const viewer = await requireViewer();
    const sql = getSql();
    // Both ids must belong to the viewer's world; the database's world-scoped keys enforce it too.
    const [ok] = await sql`
      select 1 from products p, locations l
      where p.world_id = ${viewer.worldId} and p.id = ${input.productId}
        and l.world_id = ${viewer.worldId} and l.id = ${input.destinationId} and l.kind in ('customer', 'trial_site')`;
    if (!ok) throw new Error("Choose a product and a customer or trial site.");
    if (input.dueAt.getTime() < Date.now()) throw new Error("The due date is in the past.");
    const order = await logOrder(sql, { worldId: viewer.worldId, companyId: viewer.companyId, ...input, loggedBy: viewer.personId, loggedAt: new Date() });
    revalidatePath("/orders");
    const checking = await emit({ name: "order/received", data: { worldId: viewer.worldId, companyId: viewer.companyId, orderId: order.id } });
    return checking ? { ok: true, orderCode: order.orderCode } : { ok: true, orderCode: order.orderCode, warning: "Logged. The workflow engine is not running, so the Order Desk has not checked it yet (npm run inngest)." };
  } catch (err) {
    return { ok: false, error: err instanceof z.ZodError ? "Check the order details." : err instanceof Error ? err.message : "Something went wrong." };
  }
}
