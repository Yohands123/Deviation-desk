# Domain

The data model, the realism rules the simulation must respect, and the demo company to seed.
Schema starting point: `db/schema.sql`.

---

## Entities

Every domain table carries `company_id` and `world_id`; world-scoped rows are keyed by
`(world_id, id)` (see `CLAUDE.md` §11). Human-facing codes are unique per world: `batch_code`,
`lot_code`, `shipment_code`, `order_code`, incident `code`. `src/db/resolve-ref.ts` maps a code to
its row id (`{ table: "batches", code: "A-2231" }`).

**Structure**
- `sites` → `rooms` (department, room type, cleanliness class `grade_a`–`grade_d` or `unclassified`)
  → `equipment` (type, status, last maintenance).
- `production_lines` belong to a room; equipment that belongs to a line carries `line_id`.

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
- `lanes` — transit hours and cost per unit between two locations for a storage condition. The
  Rerouter's optimizer call uses them to decide which stock can reach an order in time.

**People and work**
- `people` — name, role, site, shift.
- `incidents`, `incident_events` (append-only timeline), `tasks`, `evidence`.
- `agent_runs`, `decision_records`, `approvals`.

**Simulation**
- `worlds` (`live` | `drill`), `scenarios` (library or builder; runnable once approved),
  `drill_runs` (status, tick, difficulty, seed, facilitator, agents on/off, score),
  `hidden_truths` (restricted), `sim_effects` (append-only drill log: actor, effect, target,
  hidden flag, reversal link).

## Impact graph

Nodes: rooms, equipment, material lots, batches, inventory lots, shipments, orders, locations
(customers and trial sites are locations). Edges (the `impact_edges` view):
- room → equipment in it
- batch ↔ equipment (`batch_equipment_usage`)
- batch ↔ material lot (`batch_material_usage`)
- batch → inventory lot → shipment (`shipment_items`) → order → destination;
  shipment → its destination directly

Usage edges go both ways, so a shared lot or machine links batches to each other. Distribution
edges go downstream only. `traceImpact(sql, worldId, start, maxDepth ≤ 6)` in
`src/db/trace-impact.ts` walks these with a recursive CTE and returns each reached node once, with
its depth, the edge that reached it, its status, and a shortest path from the start. Held stock is
still traversed; its status shows where containment already cuts the spread.

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
`sim/tick`, `plan/proposed`, `scenario/requested`, `drill/started`, `drill/ended`,
`incident/dispatched` (the Dispatcher has chosen the agents), `approval/requested` (a proposal
awaits a seat's decision), `drill/play` (autoplay a drill: one tick every `seconds_per_tick`),
`drill/audit-requested` (run the Auditor's end-of-drill review).

As built, `drill/ended` is sent when a drill reaches its last hour or the facilitator ends it. A
drill tick is a function call (`runTick`), not an event; `sim/tick` and `drill/started` are unused.

Payload shapes: `src/workflows/events.ts`. Handlers: `src/workflows/handlers.ts`.

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

### As seeded (`src/db/seed/helix-biologics.ts`)

All data is fixed relative to `SEED_ANCHOR` (Mon 12 Oct 2026, 09:00 site time) and uses the seeded
PRNG, so every seed is identical.

- **Product:** HLX-201 injection, 100 mg/mL (refrigerated, 14-day sterility test).
- **Gaskets:** Filler 3 switched from lot G-69 to G-77 on 17 Sep; Filler 4 on 30 Sep.
- **Batches:** A-2227 (L4), A-2228 (L3), A-2229 (L4) released on G-69; A-2230 (L3) released on
  G-77 and partly shipped; A-2231 (L3, sterility results due 12 Oct), A-2232 (L3), A-2233 (L4, G-69),
  A-2234 (L4) in testing; A-2235 (L3) in production. A-2231 and A-2234 both use G-77.
- **Suppliers:** Kestrel Seals (gaskets, G-69 and G-77), Arbor Polymer Seals (approved backup
  gaskets), Nordvial Closures (stoppers, single source), Meridian Glassworks (vials).
- **Locations:** Warehouse Bays A–D (C is quarantine), Dock, Montreal DC, Trial sites 104 and 212,
  Northshore Hospital Pharmacy, Lakeview Specialty Pharmacy.
- **Shipments:** SH-115 (A-2230, delivered to Northshore), SH-117 (A-2229, in transit to trial
  site 104), SH-118 (800 units of A-2231 at the dock, quarantine transfer to Montreal DC),
  SH-119 (A-2230, planned to Lakeview).
- **Orders:** ORD-1041 to ORD-1047; ORD-1045 is the patient-critical order for trial site 212,
  due 14 Oct 08:00 (47 hours after the anchor). Clean released stock (G-69) sits at Montreal DC.
- **People:** 14, including Priya Raman (Plant Manager), Marcus Bell (Clinical Ops Manager),
  Elena Duarte (QA Director), Tomás Reyes (Supply Chain Lead), Hannah Okafor (Regulatory Affairs).
- **Lanes (refrigerated):** Dock → Montreal DC 6 h; Warehouse Bay A → Montreal DC 7 h, → trial
  sites 28–30 h; Montreal DC → trial site 104 20 h, → trial site 212 22 h, → Northshore 8 h,
  → Lakeview 12 h.
- **Sensors:** daily EM swabs for Fill Room 3 and Line 4 (30 days each; Fill Room 3 reads 0, 1, 2, 3
  CFU on 9–12 Oct), plus SH-117 truck temperatures inside 2–8 °C.
