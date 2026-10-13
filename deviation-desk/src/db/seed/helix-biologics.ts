/**
 * Helix Biologics, the fictional demo company (docs/DOMAIN.md §Seed). Names here are used by
 * evals, scenarios and the UI; keep them identical to the spec.
 *
 * The data tells one consistent story as of SEED_ANCHOR (Mon 12 Oct 2026, 09:00 at the site):
 * - Filler 3 got gaskets from lot G-77 on 17 Sep; Filler 4 on 30 Sep. Batches filled before
 *   that used lot G-69. So A-2230 is released stock that used G-77 and has partly shipped.
 * - A-2231 (Line 3, filled 28 Sep) is in its 14-day sterility test; results are due today.
 *   800 units sit in SH-118 at the dock, staged for a quarantine transfer to Montreal DC.
 * - Clean released stock (G-69 batches) sits at Montreal DC for the urgent trial order.
 * - Fill Room 3 EM counts rise over the last three days; its 9 Oct cleaning record is missing;
 *   the 3 Oct maintenance log notes gasket wear on Filler 3.
 * Everything is deterministic: fixed dates and the seeded PRNG, never Math.random().
 */
import type { Sql, TransactionSql } from "../client";
import { createRng } from "../../sim/prng";

export const HELIX_COMPANY_NAME = "Helix Biologics";
export const SEED_ANCHOR = new Date("2026-10-12T09:00:00-04:00");
const RNG_SEED = 20261012;

const DAY_MS = 86_400_000;
/** A time at the site (Eastern Daylight Time throughout the seed window). */
const at = (day: string, time = "08:00") => new Date(`${day}T${time}:00-04:00`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const siteDay = (date: Date) => new Date(date.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);

type Row = Record<string, unknown>;

/** Inserts rows and returns code → id for the given key column (camelCase). */
async function insertRows(tx: TransactionSql, table: string, rows: Row[], key: string): Promise<Map<string, string>> {
  const out = await tx`insert into ${tx(table)} ${tx(rows)} returning *`;
  return new Map(out.map((r) => [String(r[key]), String(r.id)]));
}

function idOf(ids: Map<string, string>, code: string): string {
  const id = ids.get(code);
  if (!id) throw new Error(`Seed bug: no id for "${code}"`);
  return id;
}

export interface SeededCompany {
  companyId: string;
  worldId: string;
}

/** Seeds a new company with its live world. `companyName` lets tests create isolated copies. */
export async function seedHelixBiologics(sql: Sql, companyName = HELIX_COMPANY_NAME): Promise<SeededCompany> {
  return sql.begin(async (tx) => {
    const [company] = await tx`insert into companies ${tx({ name: companyName })} returning id`;
    if (!company) throw new Error("Failed to create company");
    const companyId = String(company.id);
    const [world] = await tx`insert into worlds ${tx({ companyId, kind: "live" })} returning id`;
    if (!world) throw new Error("Failed to create live world");
    const worldId = String(world.id);
    const base = { worldId, companyId };
    const rng = createRng(RNG_SEED);

    // ─── Structure ───
    const sites = await insertRows(tx, "sites", [{ ...base, name: "Site 01 · Fill and Finish" }], "name");
    const siteId = idOf(sites, "Site 01 · Fill and Finish");

    const roomSpec = [
      ["Fill Room 3", "Manufacturing", "cleanroom", "grade_b", { x: 0, y: 0, w: 6, d: 5 }],
      ["Line 4", "Manufacturing", "cleanroom", "grade_b", { x: 6, y: 0, w: 6, d: 5 }],
      ["QC Lab", "Quality Control", "lab", "grade_d", { x: 12, y: 0, w: 5, d: 5 }],
      ["QA Office", "Quality Assurance", "office", "unclassified", { x: 0, y: 5, w: 5, d: 4 }],
      ["Warehouse", "Supply Chain", "storage", "unclassified", { x: 5, y: 5, w: 8, d: 4 }],
      ["Dock", "Supply Chain", "shipping", "unclassified", { x: 13, y: 5, w: 4, d: 4 }],
    ] as const;
    const rooms = await insertRows(
      tx,
      "rooms",
      roomSpec.map(([name, department, roomType, cleanlinessClass, layout]) => ({
        ...base,
        siteId,
        name,
        department,
        roomType,
        cleanlinessClass,
        layout,
      })),
      "name",
    );

    const lines = await insertRows(
      tx,
      "production_lines",
      [
        { ...base, roomId: idOf(rooms, "Fill Room 3"), name: "Line 3", unitsPerHour: 2400 },
        { ...base, roomId: idOf(rooms, "Line 4"), name: "Line 4", unitsPerHour: 2400 },
      ],
      "name",
    );

    const equipmentSpec: [string, string, string, string | null, string][] = [
      ["Filler 3", "filler", "Fill Room 3", "Line 3", "2026-10-03"],
      ["Capper 3", "capper", "Fill Room 3", "Line 3", "2026-09-15"],
      ["Filler 4", "filler", "Line 4", "Line 4", "2026-09-30"],
      ["Capper 4", "capper", "Line 4", "Line 4", "2026-09-15"],
      ["Incubator 1", "incubator", "QC Lab", null, "2026-09-01"],
      ["Incubator 2", "incubator", "QC Lab", null, "2026-09-01"],
      ["Microscope 1", "microscope", "QC Lab", null, "2026-08-20"],
      ["Cold Store 1", "cold_store", "Warehouse", null, "2026-09-10"],
    ];
    const equipment = await insertRows(
      tx,
      "equipment",
      equipmentSpec.map(([name, equipmentType, room, line, maintained]) => ({
        ...base,
        roomId: idOf(rooms, room),
        lineId: line ? idOf(lines, line) : null,
        name,
        equipmentType,
        lastMaintenanceAt: at(maintained, "14:00"),
      })),
      "name",
    );

    // ─── Suppliers and materials ───
    const suppliers = await insertRows(
      tx,
      "suppliers",
      [
        { ...base, name: "Kestrel Seals", country: "Canada" },
        { ...base, name: "Arbor Polymer Seals", country: "United States" },
        { ...base, name: "Nordvial Closures", country: "Germany" },
        { ...base, name: "Meridian Glassworks", country: "Italy" },
      ],
      "name",
    );
    const materials = await insertRows(
      tx,
      "materials",
      [
        { ...base, name: "Filling-needle gasket, silicone" },
        { ...base, name: "Vial stopper, 13 mm bromobutyl" },
        { ...base, name: "Type I glass vial, 2 mL" },
      ],
      "name",
    );
    const GASKET = idOf(materials, "Filling-needle gasket, silicone");
    const STOPPER = idOf(materials, "Vial stopper, 13 mm bromobutyl");
    const VIAL = idOf(materials, "Type I glass vial, 2 mL");

    await tx`insert into material_suppliers ${tx([
      { ...base, materialId: GASKET, supplierId: idOf(suppliers, "Kestrel Seals"), approved: true, leadTimeDays: 21 },
      // The approved backup gasket supplier.
      { ...base, materialId: GASKET, supplierId: idOf(suppliers, "Arbor Polymer Seals"), approved: true, leadTimeDays: 28 },
      // Single-source risk for the Supplier Scout to find: no approved alternative.
      { ...base, materialId: STOPPER, supplierId: idOf(suppliers, "Nordvial Closures"), approved: true, leadTimeDays: 45 },
      { ...base, materialId: VIAL, supplierId: idOf(suppliers, "Meridian Glassworks"), approved: true, leadTimeDays: 30 },
    ])}`;

    const lots = await insertRows(
      tx,
      "material_lots",
      [
        ["G-69", GASKET, "Kestrel Seals", "2026-08-05"],
        ["G-77", GASKET, "Kestrel Seals", "2026-09-02"],
        ["ST-5501", STOPPER, "Nordvial Closures", "2026-08-12"],
        ["ST-5502", STOPPER, "Nordvial Closures", "2026-09-15"],
        ["VL-3307", VIAL, "Meridian Glassworks", "2026-08-10"],
        ["VL-3310", VIAL, "Meridian Glassworks", "2026-09-12"],
      ].map(([lotCode, materialId, supplier, received]) => ({
        ...base,
        materialId,
        supplierId: idOf(suppliers, supplier as string),
        lotCode,
        receivedAt: at(received as string, "10:00"),
      })),
      "lotCode",
    );

    // ─── Product and batches ───
    const products = await insertRows(
      tx,
      "products",
      [{ ...base, name: "HLX-201 injection, 100 mg/mL", storageCondition: "refrigerated", releaseTestDays: 14 }],
      "name",
    );
    const productId = idOf(products, "HLX-201 injection, 100 mg/mL");

    // [code, line, filled on, status, gasket lot, stopper lot, vial lot]
    const batchSpec = [
      ["A-2227", "Line 4", "2026-09-10", "released", "G-69", "ST-5501", "VL-3307"],
      ["A-2228", "Line 3", "2026-09-14", "released", "G-69", "ST-5501", "VL-3307"],
      ["A-2229", "Line 4", "2026-09-17", "released", "G-69", "ST-5501", "VL-3307"],
      ["A-2230", "Line 3", "2026-09-21", "released", "G-77", "ST-5501", "VL-3307"],
      ["A-2231", "Line 3", "2026-09-28", "in_testing", "G-77", "ST-5502", "VL-3310"],
      ["A-2233", "Line 4", "2026-09-29", "in_testing", "G-69", "ST-5502", "VL-3310"],
      ["A-2232", "Line 3", "2026-10-05", "in_testing", "G-77", "ST-5502", "VL-3310"],
      ["A-2234", "Line 4", "2026-10-06", "in_testing", "G-77", "ST-5502", "VL-3310"],
      ["A-2235", "Line 3", "2026-10-12", "in_production", "G-77", "ST-5502", "VL-3310"],
    ] as const;
    const batches = await insertRows(
      tx,
      "batches",
      batchSpec.map(([batchCode, line, filled, status]) => ({
        ...base,
        productId,
        lineId: idOf(lines, line),
        batchCode,
        status,
        producedAt: at(filled, "06:00"),
        quantity: status === "in_production" ? 1800 : 3400,
      })),
      "batchCode",
    );

    const fillerOf = { "Line 3": ["Filler 3", "Capper 3"], "Line 4": ["Filler 4", "Capper 4"] } as const;
    await tx`insert into batch_equipment_usage ${tx(
      batchSpec.flatMap(([code, line]) =>
        fillerOf[line].map((name) => ({ ...base, batchId: idOf(batches, code), equipmentId: idOf(equipment, name) })),
      ),
    )}`;
    await tx`insert into batch_material_usage ${tx(
      batchSpec.flatMap(([code, , , , gasket, stopper, vial]) =>
        [gasket, stopper, vial].map((lot) => ({ ...base, batchId: idOf(batches, code), materialLotId: idOf(lots, lot) })),
      ),
    )}`;

    // ─── Locations, stock, orders, shipments ───
    const locations = await insertRows(
      tx,
      "locations",
      [
        ["Warehouse Bay A", "warehouse_bay"],
        ["Warehouse Bay B", "warehouse_bay"],
        ["Warehouse Bay C", "warehouse_bay"], // quarantine bay, empty for now
        ["Warehouse Bay D", "warehouse_bay"],
        ["Dock", "dock"],
        ["Montreal DC", "distribution_center"],
        ["Trial site 104 (study HLX-201-03)", "trial_site"],
        ["Trial site 212 (study HLX-201-04)", "trial_site"],
        ["Northshore Hospital Pharmacy", "customer"],
        ["Lakeview Specialty Pharmacy", "customer"],
      ].map(([name, kind]) => ({ ...base, name, kind })),
      "name",
    );

    // Refrigerated lanes: transit hours and cost per unit. The site ships to customers and trial
    // sites through Montreal DC; the DC can also ship straight from the site in a pinch.
    await tx`insert into lanes ${tx(
      (
        [
          ["Dock", "Montreal DC", 6, 0.4],
          ["Warehouse Bay A", "Montreal DC", 7, 0.45],
          ["Warehouse Bay A", "Trial site 212 (study HLX-201-04)", 30, 3.1],
          ["Warehouse Bay A", "Trial site 104 (study HLX-201-03)", 28, 2.9],
          ["Montreal DC", "Trial site 104 (study HLX-201-03)", 20, 1.8],
          ["Montreal DC", "Trial site 212 (study HLX-201-04)", 22, 2.1],
          ["Montreal DC", "Northshore Hospital Pharmacy", 8, 0.9],
          ["Montreal DC", "Lakeview Specialty Pharmacy", 12, 1.1],
        ] as const
      ).map(([origin, destination, transitHours, costPerUnit]) => ({
        ...base,
        originId: idOf(locations, origin),
        destinationId: idOf(locations, destination),
        storageCondition: "refrigerated",
        transitHours,
        costPerUnit,
      })),
    )}`;

    const inventorySpec = [
      ["A-2227", "Montreal DC", 1800],
      ["A-2228", "Montreal DC", 2100],
      ["A-2228", "Warehouse Bay A", 400],
      ["A-2229", "Montreal DC", 1500],
      ["A-2230", "Montreal DC", 1200],
      ["A-2231", "Warehouse Bay B", 2600],
      ["A-2231", "Dock", 800],
      ["A-2232", "Warehouse Bay B", 3200],
      ["A-2233", "Warehouse Bay B", 3100],
      ["A-2234", "Warehouse Bay B", 3300],
    ] as const;
    const inventoryRows = await tx`insert into inventory_lots ${tx(
      inventorySpec.map(([batch, location, quantity]) => ({
        ...base,
        batchId: idOf(batches, batch),
        locationId: idOf(locations, location),
        quantity,
      })),
    )} returning id`;
    const inventory = new Map(inventorySpec.map(([batch, location], i) => [`${batch} @ ${location}`, String(inventoryRows[i]?.id)]));

    const orders = await insertRows(
      tx,
      "orders",
      [
        ["ORD-1041", "Northshore Hospital Pharmacy", 600, at("2026-10-09", "12:00"), "routine", "delivered"],
        ["ORD-1043", "Trial site 104 (study HLX-201-03)", 120, at("2026-10-13", "12:00"), "high", "shipped"],
        ["ORD-1044", "Lakeview Specialty Pharmacy", 400, at("2026-10-16", "12:00"), "routine", "allocated"],
        // The urgent trial-site order: due within 48 hours of SEED_ANCHOR.
        ["ORD-1045", "Trial site 212 (study HLX-201-04)", 150, at("2026-10-14", "08:00"), "patient_critical", "open"],
        ["ORD-1046", "Northshore Hospital Pharmacy", 900, at("2026-10-27", "12:00"), "routine", "open"],
        ["ORD-1047", "Lakeview Specialty Pharmacy", 300, at("2026-11-02", "12:00"), "routine", "open"],
      ].map(([orderCode, destination, quantity, dueAt, priority, status]) => ({
        ...base,
        orderCode,
        productId,
        destinationId: idOf(locations, destination as string),
        quantity,
        dueAt,
        priority,
        status,
      })),
      "orderCode",
    );

    const shipments = await insertRows(
      tx,
      "shipments",
      [
        ["SH-115", "Montreal DC", "Northshore Hospital Pharmacy", "ORD-1041", "delivered"],
        ["SH-117", "Montreal DC", "Trial site 104 (study HLX-201-03)", "ORD-1043", "in_transit"],
        // Quarantine transfer of not-yet-released A-2231 to the DC; no customer order.
        ["SH-118", "Dock", "Montreal DC", null, "at_dock"],
        ["SH-119", "Montreal DC", "Lakeview Specialty Pharmacy", "ORD-1044", "planned"],
      ].map(([shipmentCode, origin, destination, order, status]) => ({
        ...base,
        shipmentCode,
        originId: idOf(locations, origin as string),
        destinationId: idOf(locations, destination as string),
        orderId: order ? idOf(orders, order) : null,
        carrier: "Polar Route Logistics",
        status,
        storageCondition: "refrigerated",
      })),
      "shipmentCode",
    );

    await tx`insert into shipment_items ${tx(
      (
        [
          ["SH-115", "A-2230 @ Montreal DC", 600],
          ["SH-117", "A-2229 @ Montreal DC", 120],
          ["SH-118", "A-2231 @ Dock", 800],
          ["SH-119", "A-2230 @ Montreal DC", 400],
        ] as const
      ).map(([shipment, lot, quantity]) => ({
        ...base,
        shipmentId: idOf(shipments, shipment),
        inventoryLotId: idOf(inventory, lot),
        quantity,
      })),
    )}`;

    // ─── Sensor history ───
    const readings: Row[] = [];
    const emStart = at("2026-09-13", "07:00");
    // Fill Room 3: 30 daily EM swabs. Mostly clean with rare single counts, then a three-day rise.
    const fillRoomRise = [0, 1, 2, 3]; // 9, 10, 11, 12 Oct
    for (let i = 0; i < 30; i++) {
      const tail = i - (30 - fillRoomRise.length);
      const value = tail >= 0 ? (fillRoomRise[tail] ?? 0) : rng.chance(0.08) ? 1 : 0;
      readings.push({ ...base, subjectTable: "rooms", subjectId: idOf(rooms, "Fill Room 3"), metric: "em_cfu", value, recordedAt: addDays(emStart, i) });
    }
    // Line 4: same cadence, no trend (the control room).
    for (let i = 0; i < 30; i++) {
      const value = rng.chance(0.08) ? 1 : 0;
      readings.push({ ...base, subjectTable: "rooms", subjectId: idOf(rooms, "Line 4"), metric: "em_cfu", value, recordedAt: addDays(emStart, i) });
    }
    // SH-117 in transit: truck temperature every 2 hours, inside 2–8 °C.
    const transitStart = at("2026-10-11", "10:00");
    for (let i = 0; i < 12; i++) {
      const value = Math.round((4.4 + rng.next() * 1.4) * 10) / 10;
      readings.push({
        ...base,
        subjectTable: "shipments",
        subjectId: idOf(shipments, "SH-117"),
        metric: "temp_c",
        value,
        recordedAt: new Date(transitStart.getTime() + i * 2 * 3_600_000),
      });
    }
    await tx`insert into sensor_readings ${tx(readings)}`;

    // ─── People ───
    await tx`insert into people ${tx(
      [
        ["Priya Raman", "Plant Manager", "day"],
        ["Marcus Bell", "Clinical Ops Manager", "office"],
        ["Elena Duarte", "QA Director", "office"],
        ["Tomás Reyes", "Supply Chain Lead", "office"],
        ["Hannah Okafor", "Regulatory Affairs Lead", "office"],
        ["Daniel Brooks", "Chief Operating Officer", "office"],
        ["Sofia Lindqvist", "Strategy & Growth Lead", "office"],
        ["Kwame Mensah", "QC Microbiologist", "day"],
        ["Aisha Siddiqui", "QC Analyst", "night"],
        ["Jonah Weiss", "Filling Operator, Line 3", "day"],
        ["Mei Tanaka", "Filling Operator, Line 4", "night"],
        ["Luca Moretti", "Maintenance Technician", "day"],
        ["Grace Adeyemi", "Warehouse Supervisor", "day"],
        ["Ravi Patel", "Cleanroom Technician", "night"],
      ].map(([name, role, shift]) => ({ ...base, siteId, name, role, shift })),
    )}`;

    // ─── Records ───
    const records: Row[] = [];
    const record = (r: { recordType: string; subjectTable: string | null; subjectId: string | null; title: string; body: string; recordedAt: Date }) =>
      records.push({ ...base, ...r });

    for (const [title, body] of [
      ["SOP-QA-004 Deviation handling", "Open a deviation within 24 hours of discovery. Assess product impact, contain affected material, investigate root cause, and define CAPA. QA approves closure."],
      ["SOP-CL-012 Cleanroom cleaning and sanitization", "Grade B filling rooms are cleaned and sanitized at the end of every production day. Each cleaning is recorded with date, time, agent used, and operator."],
      ["SOP-QC-021 Sterility testing", "Sterility samples are incubated for 14 days. A batch may not be released before a passing result and QA batch record review."],
      ["SOP-SC-007 Quarantine and hold", "Material under investigation is placed on hold and moved to Warehouse Bay C. Holds are released only by QA."],
    ] as const) {
      record({ recordType: "sop", subjectTable: null, subjectId: null, title, body, recordedAt: at("2026-01-15", "09:00") });
    }

    // Daily cleaning of both filling rooms. Fill Room 3 has no record for 9 Oct (the deliberate gap).
    for (const room of ["Fill Room 3", "Line 4"] as const) {
      for (let i = 0; i < 29; i++) {
        const when = addDays(at("2026-09-13", "18:30"), i);
        const day = siteDay(when);
        if (room === "Fill Room 3" && day === "2026-10-09") continue;
        record({
          recordType: "cleaning",
          subjectTable: "rooms",
          subjectId: idOf(rooms, room),
          title: `${room} end-of-day cleaning, ${day}`,
          body: `End-of-day cleaning and sanitization of ${room} per SOP-CL-012. Agent: sporicidal rotation. Operator: ${i % 2 === 0 ? "Ravi Patel" : "Jonah Weiss"}.`,
          recordedAt: when,
        });
      }
    }

    const maintenance = [
      ["Filler 3", "2026-09-17", "Filler 3 gasket change", "Replaced filling-needle gaskets with new set from lot G-77 (Kestrel Seals). Line cleared after changeover cleaning."],
      ["Filler 4", "2026-09-20", "Filler 4 preventive maintenance", "Routine preventive maintenance. No findings."],
      ["Filler 4", "2026-09-30", "Filler 4 gasket change", "Replaced filling-needle gaskets with new set from lot G-77 (Kestrel Seals). Line cleared after changeover cleaning."],
      ["Filler 3", "2026-10-03", "Filler 3 preventive maintenance", "Observed wear on filling-needle gasket (lot G-77). Seal still within tolerance; replacement recommended at next changeover. Technician: Luca Moretti."],
    ] as const;
    for (const [machine, day, title, body] of maintenance) {
      record({ recordType: "maintenance", subjectTable: "equipment", subjectId: idOf(equipment, machine), title, body, recordedAt: at(day, "14:00") });
    }

    for (const [code, , filled, status] of batchSpec) {
      if (status !== "released") continue;
      const resultAt = addDays(at(filled, "10:00"), 14);
      record({
        recordType: "test_result",
        subjectTable: "batches",
        subjectId: idOf(batches, code),
        title: `${code} sterility test: pass`,
        body: `14-day sterility incubation per SOP-QC-021 completed ${siteDay(resultAt)}. No growth observed. Analyst: Kwame Mensah.`,
        recordedAt: resultAt,
      });
    }
    await tx`insert into records ${tx(records)}`;

    return { companyId, worldId };
  });
}
