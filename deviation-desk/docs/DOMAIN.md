# Domain

The data model, the realism rules the simulation must respect, and the demo company to seed.
Schema starting point: `db/schema.sql`.

---

## Entities

Every domain table carries `company_id` and `world_id`.

**Structure**
- `sites` → `rooms` (department, room type, cleanliness class) → `equipment` (type, status, last maintenance).
- `production_lines` belong to a room and use equipment.

**Materials and product**
- `materials` (e.g. vial stoppers, gaskets, media) supplied by `suppliers` (approved flag per material).
- `material_lots` — specific received lots of a material.
- `products` — what the company makes, with storage condition (refrigerated, frozen, ambient).
- `batches` — a production run of a product on a line; status: `in_production`, `in_testing`,
  `released`, `quarantined`, `rejected`.
- `batch_material_usage` and `batch_equipment_usage` — the edges of the impact graph.

**Stock and movement**
- `inventory_lots` — quantity of a batch at a location (warehouse bay, site, depot).
- `orders` — customer or trial-site demand: quantity, due date, priority.
- `shipments` and `shipment_items` — what is moving where, with carrier and storage condition.
- `sensor_readings` — EM swabs, equipment readings, room and shipment temperatures.

**People and work**
- `people` — name, role, site, shift.
- `incidents`, `incident_events` (append-only timeline), `tasks`, `evidence`.
- `agent_runs`, `decision_records`, `approvals`.

**Simulation**
- `worlds` (`live` | `drill`), `scenarios`, `drill_runs`, `hidden_truths` (restricted).

## Impact graph

Nodes: rooms, equipment, material lots, batches, inventory lots, shipments, orders, customers.
Edges:
- batch ↔ equipment (`batch_equipment_usage`)
- batch ↔ material lot (`batch_material_usage`)
- batch → inventory lot → shipment (`shipment_items`) → order → customer / trial site

`trace_impact(world_id, start_node, max_depth)` walks these with a recursive CTE.

## Severity scale

| Level | Meaning | Example |
|---|---|---|
| `info` | Noted, no action needed | Single EM reading at alert level, then normal |
| `watch` | Trend worth watching | EM counts rising three days in a row |
| `warning` | Action needed soon | Equipment out of tolerance, no product affected yet |
| `critical` | Product or patient risk | Batch fails sterility; shipped product may be affected |

Status colors follow `docs/DESIGN.md`. Red/orange is reserved for `critical`.

## Event names (Inngest)

`sensor/anomaly`, `signal/confirmed`, `report/submitted`, `incident/opened`,
`incident/reclassified`, `evidence/updated`, `root_cause/proposed`, `challenge/raised`,
`root_cause/accepted`, `impact/updated`, `hold/approved`, `shortfall/detected`,
`shipment/temp_excursion`, `supplier/delay`, `order/received`, `order/urgent`,
`board/convened`, `decision/resolved`, `incident/escalated`, `incident/closed`,
`sim/tick`, `plan/proposed`, `scenario/requested`, `drill/started`, `drill/ended`.

---

## Realism

These are **simulation defaults**, configurable per customer. They exist so the simulation never
resolves faster than reality. Before showing them to customers, confirm values with a domain
expert, because real values vary by product, site, and procedure.

- **Sterility testing** for sterile products typically involves about **14 days** of incubation
  before results. A batch cannot be released earlier.
- **QA release** requires batch record review and QA sign-off after testing; model this as its own
  step with its own duration and capacity.
- **Urgent orders** are usually served from **already released** stock. "Make it tomorrow" is
  normally impossible for a sterile product; the Scheduler must say so and show the earliest date.
- **Cold chain:** refrigerated products are commonly stored at **2–8 °C**; frozen and ultra-cold
  products have their own ranges. Excursions are judged by both temperature and duration.
- **Cleaning and changeover** take time and must be recorded; missing cleaning records are a
  classic investigation gap.
- **Investigations and CAPA** take days to weeks; containment should happen in hours.
- **Humans are not instant.** AI-played seats in drills should include realistic response delays,
  missed messages at shift change, and occasional pushback.

---

## Seed: Helix Biologics (fictional demo company)

One site, **Site 01 · Fill and Finish**. Use these names consistently in seed data, evals, and UI.

**Rooms**
| Room | Type | Notes |
|---|---|---|
| Fill Room 3 | Cleanroom | Line 3, Filler 3 |
| Line 4 | Cleanroom | Line 4, Filler 4 (shares gasket lot G-77 with Filler 3) |
| QC Lab | Lab | Microscopes, incubators, sample racks |
| QA Office | Office | Investigations, evidence board |
| Warehouse | Storage | Bays A–D; bay C used for quarantine |
| Dock | Shipping | Refrigerated trucks |

**Products:** one refrigerated injectable (2–8 °C) used in two clinical trials and sold commercially.

**Batches:** at least 6, including `A-2231` (Line 3) and `A-2234` (Line 4), both using gasket lot `G-77`.

**Suppliers:** 4, including a single-source vial stopper supplier (for Supplier Scout to find)
and one approved backup gasket supplier.

**Locations:** the site warehouse plus a distribution center ("Montreal DC") with released stock.

**Shipments:** at least 3, including `SH-118` (at the dock, contains A-2231 units).

**Orders:** at least 5, including one urgent trial-site order due within 48 hours.

**People:** ~14 across roles, including Priya (Plant Manager) and Marcus (Clinical Ops).

**Sensor history:** 30 days of EM readings for Fill Room 3 with a rising trend over the final
3 days, so the Signal Watcher has something real to find.

**Records with a deliberate gap:** the Oct 9 cleaning record for Fill Room 3 is missing (for the
Devil's Advocate), and the Oct 3 maintenance log notes gasket wear on Filler 3.
