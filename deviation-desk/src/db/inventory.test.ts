import { describe, expect, it } from "vitest";
import { computePosition, type OrderRow, type OrderShipment, type StockLot } from "./inventory";

const asOf = new Date("2026-10-12T13:00:00Z");
const day = (n: number) => new Date(asOf.getTime() + n * 86_400_000);

const lot = (over: Partial<StockLot>): StockLot => ({
  id: "lot",
  batchCode: "A-1",
  batchStatus: "released",
  producedAt: null,
  locationName: "Montreal DC",
  locationKind: "distribution_center",
  quantity: 100,
  onHold: false,
  committed: 0,
  ...over,
});
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: "o1",
  orderCode: "ORD-1",
  destination: "Trial site",
  quantity: 50,
  dueAt: day(2),
  priority: "routine",
  status: "open",
  ...over,
});
const shipment = (over: Partial<OrderShipment>): OrderShipment => ({
  shipmentCode: "SH-1",
  orderId: "o1",
  status: "planned",
  clean: true,
  ...over,
});

describe("computePosition", () => {
  it("sorts stock into available (minus reservations), at risk and pending", () => {
    const p = computePosition(
      [
        lot({ id: "free", committed: 40 }),
        lot({ id: "held", onHold: true }),
        lot({ id: "quarantined", batchStatus: "quarantined" }),
        lot({ id: "testing", batchStatus: "in_testing" }),
        lot({ id: "dock", locationKind: "dock" }),
        lot({ id: "reserved", committed: 100 }),
      ],
      [],
      [],
      asOf,
    );
    expect(p.available.map((l) => [l.id, l.free])).toEqual([["free", 60]]);
    expect(p.atRisk.map((l) => l.id)).toEqual(["held", "quarantined"]);
    expect(p.pending.map((l) => l.id)).toEqual(["testing"]);
  });

  it("counts an order covered only by a clean, active shipment", () => {
    const p = computePosition(
      [],
      [order({ id: "a", orderCode: "A" }), order({ id: "b", orderCode: "B" }), order({ id: "c", orderCode: "C" })],
      [
        shipment({ orderId: "a", shipmentCode: "SH-A" }),
        shipment({ orderId: "b", shipmentCode: "SH-B", status: "held" }),
        shipment({ orderId: "c", shipmentCode: "SH-C", clean: false }),
      ],
      asOf,
    );
    expect(p.uncovered.map((o) => o.orderCode)).toEqual(["B", "C"]);
    expect(p.uncovered.map((o) => o.blockedShipments)).toEqual([["SH-B"], ["SH-C"]]);
  });

  it("only looks at undelivered orders inside the horizon, soonest first", () => {
    const p = computePosition(
      [],
      [
        order({ id: "late", orderCode: "LATE", dueAt: day(20) }),
        order({ id: "done", orderCode: "DONE", status: "delivered" }),
        order({ id: "soon", orderCode: "SOON", dueAt: day(1) }),
        order({ id: "next", orderCode: "NEXT", dueAt: day(5) }),
      ],
      [],
      asOf,
    );
    expect(p.orders.map((o) => o.orderCode)).toEqual(["SOON", "NEXT"]);
  });
});
