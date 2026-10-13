/**
 * Reference data for Helix Biologics that later phases added: contacts, the regulatory library,
 * product prices and shared capacity.
 * Idempotent (existing rows are skipped), so `npm run db:seed` can add it to a company seeded
 * before it existed.
 *
 * The regulatory library is FICTIONAL: an invented authority with invented rules, shaped like real
 * reporting obligations so the Regulator agents have something realistic to search. Nothing here
 * is legal advice, and the UI says so.
 */
import type { Sql, TransactionSql } from "../client";

type Db = Sql | TransactionSql;

export const FICTIONAL_AUTHORITY = "Northern Medicines Authority (fictional)";

interface RuleSeed {
  code: string;
  title: string;
  appliesTo: "all" | "biologic" | "device" | "clinical" | "distribution";
  appliesWhen: string;
  deadlineHours: number;
  clockStarts: "awareness" | "confirmation";
  requiredDocuments: string[];
  body: string;
}

const RULES: RuleSeed[] = [
  {
    code: "NMA-QD-1",
    title: "Initial quality defect report",
    appliesTo: "biologic",
    appliesWhen: "A batch that has been released or distributed may have a quality defect that could affect patient safety.",
    deadlineHours: 72,
    clockStarts: "awareness",
    requiredDocuments: ["Quality defect report form QD-1", "Distribution list for the affected batches", "Initial health risk assessment"],
    body: "Fictional rule for the demo company. When a marketing authorization holder becomes aware that a released or distributed batch may be defective in a way that could harm patients, it notifies the NMA Quality Defects Unit within 72 hours of awareness, even if the investigation is still open.",
  },
  {
    code: "NMA-QD-2",
    title: "Quality defect follow-up report",
    appliesTo: "biologic",
    appliesWhen: "An initial quality defect report (NMA-QD-1) was submitted.",
    deadlineHours: 720,
    clockStarts: "confirmation",
    requiredDocuments: ["Investigation summary", "Root cause statement", "CAPA plan"],
    body: "Fictional rule for the demo company. Within 30 days of the initial report, the holder sends the investigation outcome, the confirmed root cause and the corrective and preventive actions.",
  },
  {
    code: "NMA-CT-4",
    title: "Clinical trial supply notice",
    appliesTo: "clinical",
    appliesWhen: "Investigational product at, or shipped to, a trial site may be affected by a quality defect or a supply interruption.",
    deadlineHours: 48,
    clockStarts: "awareness",
    requiredDocuments: ["Affected batch and kit list", "Affected trial sites", "Subject impact assessment"],
    body: "Fictional rule for the demo company. The sponsor notifies the NMA Clinical Trials Unit within 48 hours when trial supply may be affected, and tells the affected investigators directly.",
  },
  {
    code: "NMA-RC-2",
    title: "Recall notification",
    appliesTo: "distribution",
    appliesWhen: "The company decides to recall distributed product.",
    deadlineHours: 24,
    clockStarts: "confirmation",
    requiredDocuments: ["Recall strategy and depth", "Distribution list", "Draft customer notice"],
    body: "Fictional rule for the demo company. A recall decision is notified within 24 hours, before or together with the notices to customers.",
  },
  {
    code: "NMA-CC-3",
    title: "Cold chain excursion of distributed product",
    appliesTo: "distribution",
    appliesWhen: "Distributed product was delivered or used after a temperature excursion outside its labelled storage range.",
    deadlineHours: 120,
    clockStarts: "awareness",
    requiredDocuments: ["Temperature record", "Stability justification", "Customer list"],
    body: "Fictional rule for the demo company. Excursions are reported only when affected product reached a customer or patient; excursions caught before delivery are handled internally.",
  },
  {
    code: "NMA-SD-5",
    title: "Supply disruption notice",
    appliesTo: "all",
    appliesWhen: "A marketed product is expected to be short for more than 14 days.",
    deadlineHours: 120,
    clockStarts: "awareness",
    requiredDocuments: ["Expected shortage duration", "Mitigation plan"],
    body: "Fictional rule for the demo company. Expected shortages longer than 14 days are notified within 5 days so the authority can plan alternatives.",
  },
  {
    code: "NMA-DV-9",
    title: "Medical device incident report",
    appliesTo: "device",
    appliesWhen: "A medical device malfunction or deterioration may have led, or could lead, to serious harm.",
    deadlineHours: 360,
    clockStarts: "awareness",
    requiredDocuments: ["Device incident form DV-9", "Device identification"],
    body: "Fictional rule for the demo company. Applies to medical devices only; Helix Biologics makes no devices.",
  },
];

interface ContactSeed {
  name: string;
  organization: string;
  kind: "customer" | "trial_site" | "supplier" | "internal" | "regulator";
  role: string;
  email: string;
  location?: string;
  supplier?: string;
}

const CONTACTS: ContactSeed[] = [
  { name: "Amara Singh", organization: "Northshore Hospital Pharmacy", kind: "customer", role: "Pharmacy Director", email: "amara.singh@northshore-hospital.example", location: "Northshore Hospital Pharmacy" },
  { name: "Leo Fontaine", organization: "Lakeview Specialty Pharmacy", kind: "customer", role: "Pharmacist in Charge", email: "leo.fontaine@lakeview-pharmacy.example", location: "Lakeview Specialty Pharmacy" },
  { name: "Dr. Ines Carvalho", organization: "Trial site 104 (study HLX-201-03)", kind: "trial_site", role: "Principal Investigator", email: "ines.carvalho@site104.example", location: "Trial site 104 (study HLX-201-03)" },
  { name: "Dr. Samuel Osei", organization: "Trial site 212 (study HLX-201-04)", kind: "trial_site", role: "Principal Investigator", email: "samuel.osei@site212.example", location: "Trial site 212 (study HLX-201-04)" },
  { name: "Kestrel Seals order desk", organization: "Kestrel Seals", kind: "supplier", role: "Order desk", email: "orders@kestrel-seals.example", supplier: "Kestrel Seals" },
  { name: "Nadia Petrov", organization: "Arbor Polymer Seals", kind: "supplier", role: "Account Manager", email: "nadia.petrov@arbor-polymer.example", supplier: "Arbor Polymer Seals" },
  { name: "Nordvial customer service", organization: "Nordvial Closures", kind: "supplier", role: "Customer service", email: "service@nordvial.example", supplier: "Nordvial Closures" },
  { name: "Meridian sales office", organization: "Meridian Glassworks", kind: "supplier", role: "Sales", email: "sales@meridian-glass.example", supplier: "Meridian Glassworks" },
  { name: "NMA Quality Defects Unit", organization: FICTIONAL_AUTHORITY, kind: "regulator", role: "Quality defect reports", email: "quality-defects@nma.example" },
  { name: "NMA Clinical Trials Unit", organization: FICTIONAL_AUTHORITY, kind: "regulator", role: "Clinical trial notices", email: "clinical-trials@nma.example" },
  { name: "Elena Duarte", organization: "Helix Biologics", kind: "internal", role: "QA Director", email: "elena.duarte@helix.example" },
  { name: "Priya Raman", organization: "Helix Biologics", kind: "internal", role: "Plant Manager", email: "priya.raman@helix.example" },
  { name: "Tomás Reyes", organization: "Helix Biologics", kind: "internal", role: "Supply Chain Lead", email: "tomas.reyes@helix.example" },
  { name: "Hannah Okafor", organization: "Helix Biologics", kind: "internal", role: "Regulatory Affairs Lead", email: "hannah.okafor@helix.example" },
  { name: "Marcus Bell", organization: "Helix Biologics", kind: "internal", role: "Clinical Ops Manager", email: "marcus.bell@helix.example" },
  { name: "Daniel Brooks", organization: "Helix Biologics", kind: "internal", role: "Chief Operating Officer", email: "daniel.brooks@helix.example" },
  { name: "Grace Adeyemi", organization: "Helix Biologics", kind: "internal", role: "Warehouse Supervisor", email: "grace.adeyemi@helix.example" },
];

/** List price per vial, used for cost trade-offs (Event Council finance, recall exposure). */
const UNIT_PRICES: Record<string, number> = { "HLX-201 injection, 100 mg/mL": 380 };

/** [name, kind, line name, capacity, basis, task hours, notes] */
const CAPACITY: Array<[string, "fill_line" | "sterility_test" | "qa_release" | "dispatch", string | null, number, "per_day" | "concurrent", number, string]> = [
  ["Line 3 aseptic fill", "fill_line", "Line 3", 1, "per_day", 10, "One batch per day: fill, changeover cleaning and EM."],
  ["Line 4 aseptic fill", "fill_line", "Line 4", 1, "per_day", 10, "One batch per day: fill, changeover cleaning and EM."],
  ["Sterility test incubators", "sterility_test", null, 12, "concurrent", 336, "Incubator 1 and 2, six test slots each; a test holds a slot for 14 days."],
  ["QA batch record review", "qa_release", null, 2, "per_day", 24, "QA reviews and signs off up to two batch records per day."],
  ["Dock dispatch", "dispatch", null, 6, "per_day", 2, "Refrigerated trucks loaded and dispatched per day."],
];

/** Who decides outside incidents (expansion, agent lessons). */
const STANDING_SEATS: Record<string, string> = {
  "Elena Duarte": "qa_director",
  "Priya Raman": "plant_manager",
  "Tomás Reyes": "supply_chain_lead",
  "Hannah Okafor": "regulatory_affairs",
  "Marcus Bell": "clinical_ops",
  "Daniel Brooks": "executive",
  "Sofia Lindqvist": "strategy_growth",
};

/** [kind, description, unit, unit cost, lead time in months]. Planning figures for the demo. */
const INVESTMENTS: Array<[string, string, string, number, number]> = [
  ["fill_line", "New aseptic fill line with isolator, validated", "line", 18_500_000, 24],
  ["test_capacity", "Sterility test incubator slot, installed and validated", "slot", 45_000, 3],
  ["qa_capacity", "QA batch record reviewer (one more review per day)", "review per day, per year", 160_000, 4],
  ["backup_supplier", "Qualify a backup supplier (audit, samples, validation)", "supplier", 120_000, 9],
  ["distribution_center", "Refrigerated distribution center through a 3PL", "site, per year", 1_400_000, 6],
];

/** Adds the reference data to a world. Returns how many rows were new. */
export async function seedReferenceData(db: Db, worldId: string, companyId: string): Promise<{ contacts: number; rules: number; capacity: number }> {
  const base = { worldId, companyId };
  for (const [name, price] of Object.entries(UNIT_PRICES)) {
    await db`update products set unit_price_usd = ${price} where world_id = ${worldId} and name = ${name} and unit_price_usd = 0`;
  }
  const lines = new Map(
    (await db<{ id: string; name: string }[]>`select id, name from production_lines where world_id = ${worldId}`).map((r) => [r.name, r.id]),
  );
  for (const [name, seat] of Object.entries(STANDING_SEATS)) {
    await db`update people set standing_seat = ${seat} where world_id = ${worldId} and name = ${name} and standing_seat is null`;
  }
  await db`
    insert into investment_options ${db(INVESTMENTS.map(([kind, description, unit, unitCostUsd, leadTimeMonths]) => ({ ...base, kind, description, unit, unitCostUsd, leadTimeMonths })))}
    on conflict (world_id, kind) do nothing`;
  const capacity = await db`
    insert into capacity_resources ${db(
      CAPACITY.map(([name, kind, line, cap, capacityBasis, taskHours, notes]) => ({
        ...base,
        name,
        kind,
        lineId: line ? (lines.get(line) ?? null) : null,
        capacity: cap,
        capacityBasis,
        taskHours,
        notes,
      })),
    )}
    on conflict (world_id, name) do nothing
    returning id`;
  const rules = await db`
    insert into regulatory_rules ${db(RULES.map((r) => ({ ...base, ...r, authority: FICTIONAL_AUTHORITY, fictional: true })))}
    on conflict (world_id, code) do nothing
    returning id`;

  const locations = new Map(
    (await db<{ id: string; name: string }[]>`select id, name from locations where world_id = ${worldId}`).map((r) => [r.name, r.id]),
  );
  const suppliers = new Map(
    (await db<{ id: string; name: string }[]>`select id, name from suppliers where world_id = ${worldId}`).map((r) => [r.name, r.id]),
  );
  const contacts = await db`
    insert into contacts ${db(
      CONTACTS.map(({ location, supplier, ...c }) => ({
        ...base,
        ...c,
        locationId: location ? (locations.get(location) ?? null) : null,
        supplierId: supplier ? (suppliers.get(supplier) ?? null) : null,
      })),
    )}
    on conflict (world_id, email) do nothing
    returning id`;
  return { contacts: contacts.length, rules: rules.length, capacity: capacity.length };
}
