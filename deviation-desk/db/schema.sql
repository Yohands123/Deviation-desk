-- Deviation Desk — initial schema
-- Becomes db/migrations/0001_init.sql in Phase 1.
-- Rules: every domain table has company_id + world_id; audit tables are append-only.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ─── Tenancy and worlds ──────────────────────────────────────────────

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table worlds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  kind text not null check (kind in ('live', 'drill')),
  cloned_from uuid references worlds(id),
  seed bigint,                                   -- drill PRNG seed
  sim_clock timestamptz,                         -- current simulated time (drills)
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);
create unique index one_live_world_per_company on worlds(company_id) where kind = 'live';

-- ─── Structure ──────────────────────────────────────────────────────

create table sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  world_id uuid not null references worlds(id),
  name text not null
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  site_id uuid not null references sites(id),
  name text not null,
  room_type text not null check (room_type in ('cleanroom','lab','office','storage','shipping','other')),
  status text not null default 'clear' check (status in ('clear','watch','at_risk','critical','locked')),
  layout jsonb                                   -- voxel placement: {x, y, w, d}
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  room_id uuid not null references rooms(id),
  name text not null,
  equipment_type text not null,
  status text not null default 'running' check (status in ('running','halted','maintenance','failed')),
  last_maintenance_at timestamptz
);

create table production_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  room_id uuid not null references rooms(id),
  name text not null,
  status text not null default 'running' check (status in ('running','halted','changeover')),
  units_per_hour integer not null
);

-- ─── Materials, products, batches ───────────────────────────────────

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  name text not null, country text
);

create table materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  name text not null
);

create table material_suppliers (
  material_id uuid not null references materials(id),
  supplier_id uuid not null references suppliers(id),
  world_id uuid not null references worlds(id),
  approved boolean not null default false,
  lead_time_days integer,
  primary key (material_id, supplier_id)
);

create table material_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  material_id uuid not null references materials(id),
  supplier_id uuid references suppliers(id),
  lot_code text not null,
  received_at timestamptz
);

create table products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  name text not null,
  storage_condition text not null check (storage_condition in ('ambient','refrigerated','frozen','ultra_cold')),
  release_test_days integer not null default 14   -- realism: see docs/DOMAIN.md
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  product_id uuid not null references products(id),
  line_id uuid references production_lines(id),
  batch_code text not null,
  status text not null check (status in ('in_production','in_testing','released','quarantined','rejected')),
  produced_at timestamptz,
  quantity integer not null
);

-- Impact graph edges
create table batch_equipment_usage (
  world_id uuid not null references worlds(id),
  batch_id uuid not null references batches(id),
  equipment_id uuid not null references equipment(id),
  primary key (world_id, batch_id, equipment_id)
);

create table batch_material_usage (
  world_id uuid not null references worlds(id),
  batch_id uuid not null references batches(id),
  material_lot_id uuid not null references material_lots(id),
  primary key (world_id, batch_id, material_lot_id)
);

-- ─── Stock, orders, shipments ───────────────────────────────────────

create table locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  name text not null,
  kind text not null check (kind in ('warehouse_bay','distribution_center','trial_site','customer','dock'))
);

create table inventory_lots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  batch_id uuid not null references batches(id),
  location_id uuid not null references locations(id),
  quantity integer not null,
  on_hold boolean not null default false
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  product_id uuid not null references products(id),
  destination_id uuid not null references locations(id),
  quantity integer not null,
  due_at timestamptz not null,
  priority text not null check (priority in ('routine','high','patient_critical')),
  status text not null default 'open' check (status in ('open','allocated','shipped','delivered','at_risk','cancelled'))
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  shipment_code text not null,
  origin_id uuid references locations(id),
  destination_id uuid references locations(id),
  order_id uuid references orders(id),
  status text not null check (status in ('planned','at_dock','in_transit','held','delivered')),
  storage_condition text not null
);

create table shipment_items (
  world_id uuid not null references worlds(id),
  shipment_id uuid not null references shipments(id),
  inventory_lot_id uuid not null references inventory_lots(id),
  quantity integer not null,
  primary key (world_id, shipment_id, inventory_lot_id)
);

create table sensor_readings (
  id bigserial primary key,
  company_id uuid not null, world_id uuid not null references worlds(id),
  subject_table text not null,                  -- 'rooms' | 'equipment' | 'shipments'
  subject_id uuid not null,
  metric text not null,                          -- 'em_cfu', 'temp_c', 'humidity_pct', ...
  value numeric not null,
  recorded_at timestamptz not null
);
create index sensor_by_subject on sensor_readings(world_id, subject_id, metric, recorded_at desc);

-- ─── People and records ─────────────────────────────────────────────

create table people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  name text not null, role text not null, shift text
);

create table records (                           -- maintenance logs, cleaning records, SOPs, test results
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  record_type text not null,                     -- 'maintenance','cleaning','sop','test_result','batch_record'
  subject_table text, subject_id uuid,
  title text not null,
  body text not null,
  recorded_at timestamptz,
  embedding vector(1024)
);

-- ─── Incidents and the audit trail ──────────────────────────────────

create table incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null, world_id uuid not null references worlds(id),
  code text not null,                            -- e.g. DEV-0412
  title text not null,
  incident_type text not null,
  severity text not null check (severity in ('info','watch','warning','critical')),
  priority integer not null default 50,
  status text not null default 'open' check (status in ('open','paused','contained','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table incident_events (                   -- append-only timeline
  id bigserial primary key,
  world_id uuid not null references worlds(id),
  incident_id uuid not null references incidents(id),
  actor_type text not null check (actor_type in ('agent','human','watcher','system','saboteur')),
  actor_id text not null,
  seat text,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table seats (
  incident_id uuid not null references incidents(id),
  role text not null,
  person_id uuid references people(id),          -- null = AI playing
  primary key (incident_id, role)
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id),
  incident_id uuid not null references incidents(id),
  source_table text not null, source_id uuid,
  added_by_type text not null check (added_by_type in ('agent','human')),
  added_by text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id),
  incident_id uuid not null references incidents(id),
  title text not null,
  owner_seat text,
  status text not null default 'open' check (status in ('open','done','blocked')),
  due_at timestamptz
);

create table agent_configs (
  id text primary key,                           -- e.g. 'root_cause_analyst'
  config jsonb not null,                         -- validated against AgentConfig (src/agents/contract.ts)
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table agent_runs (                        -- append-only
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id),
  incident_id uuid references incidents(id),
  agent_id text not null,
  model text not null,
  input_tokens integer, output_tokens integer,
  cost_usd numeric(10,4),
  latency_ms integer,
  status text not null check (status in ('ok','retried','invalid','budget_exceeded','error')),
  trace_id text,
  created_at timestamptz not null default now()
);

create table decision_records (                  -- append-only
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id),
  incident_id uuid not null references incidents(id),
  agent_run_id uuid references agent_runs(id),
  agent_id text not null,
  record jsonb not null,                         -- validated DecisionRecord
  requires_approval boolean not null,
  created_at timestamptz not null default now()
);

create table approvals (                         -- append-only
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id),
  decision_record_id uuid not null references decision_records(id),
  seat text not null,
  person_id uuid references people(id),          -- null only allowed in drill worlds (AI seat)
  outcome text not null check (outcome in ('approved','rejected','override','more_evidence')),
  reason text,
  created_at timestamptz not null default now()
);

-- ─── Simulation ─────────────────────────────────────────────────────

create table scenarios (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  spec jsonb not null,                           -- validated Scenario (src/sim/scenario.ts), without hidden truth
  created_by text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table hidden_truths (                     -- RLS: readable only by the auditor's end-of-drill step
  scenario_id uuid primary key references scenarios(id),
  truth jsonb not null
);

create table drill_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id),
  world_id uuid not null references worlds(id),
  seed bigint not null,
  level integer not null default 1,
  status text not null default 'running' check (status in ('running','ended')),
  score jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- ─── Monitoring ─────────────────────────────────────────────────────

create table watcher_heartbeats (
  watcher_id text primary key,
  last_seen_at timestamptz not null
);

-- Common indexes (extend as agents' queries grow)
create index batches_world_code on batches(world_id, batch_code);
create index incidents_world_status on incidents(world_id, status);
create index events_incident on incident_events(incident_id, created_at);
create index decisions_incident on decision_records(incident_id, created_at);
