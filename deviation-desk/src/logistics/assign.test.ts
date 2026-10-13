import { describe, expect, it } from "vitest";
import { assign, serviceOrder, tradeOff, type Demand, type Supply } from "./assign";

const supply = (id: string, units: number, readyHours: number, transit = 20): Supply => ({
  id,
  label: id,
  kind: "in_testing",
  units,
  readyHours,
  transitHours: { Site: transit },
});
const demand = (orderCode: string, quantity: number, dueHours: number, priority: Demand["priority"] = "routine"): Demand => ({
  orderCode,
  destination: "Site",
  quantity,
  priority,
  dueHours,
});

describe("assign", () => {
  it("serves patient-critical orders first, then by due time", () => {
    const order = serviceOrder([demand("R", 1, 10), demand("P", 1, 99, "patient_critical"), demand("H", 1, 5, "high")]);
    expect(order.map((d) => d.orderCode)).toEqual(["P", "H", "R"]);
  });

  it("takes the soonest supplies first, splitting an order when one supply is not enough", () => {
    const result = assign([demand("A", 300, 100), demand("B", 300, 100)], [supply("early", 400, 10), supply("late", 400, 200)]);
    expect(result).toEqual([
      { orderCode: "A", parts: [{ supplyId: "early", label: "early", units: 300, arrivesHours: 30 }], arrivesHours: 30, lateHours: 0 },
      {
        orderCode: "B",
        parts: [
          { supplyId: "early", label: "early", units: 100, arrivesHours: 30 },
          { supplyId: "late", label: "late", units: 200, arrivesHours: 220 },
        ],
        arrivesHours: 220,
        lateHours: 120,
      },
    ]);
  });

  it("leaves an order unserved when nothing reaches its destination or there is not enough", () => {
    expect(assign([{ ...demand("X", 1, 10), destination: "Nowhere" }], [supply("s", 10, 0)])[0]?.arrivesHours).toBeNull();
    expect(assign([demand("Y", 50, 10)], [supply("s", 10, 0)])[0]).toMatchObject({ parts: [], arrivesHours: null });
  });

  it("shows who is bumped if a routine order jumps the queue", () => {
    const t = tradeOff("LATE", [demand("FIRST", 300, 50, "high"), demand("LATE", 300, 60)], [supply("early", 300, 10), supply("later", 300, 300)]);
    expect(t).toEqual({ normalArrivesHours: 320, firstArrivesHours: 30, bumped: [{ orderCode: "FIRST", fromHours: 30, toHours: 320, delayHours: 290 }] });
  });
});
