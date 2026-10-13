-- Deviation Desk — initial schema.
--
-- World isolation (CLAUDE.md §2.5) is enforced by the database, not just by code:
--  * Every world-scoped row's primary key is (world_id, id), and every foreign key between
--    world-scoped rows includes world_id. A row in one world cannot reference a row in another.
--  * A drill clone copies rows and changes only world_id, so an object keeps the same id in live
--    and in every drill cloned from it.
--  * (world_id, company_id) references worlds(id, company_id), so company_id always matches the
--    world. Indexes lead with world_id; company filtering follows from the world.
-- Audit tables are append-only (triggers below). RLS is on for every table with no policies yet:
-- the anon/authenticated API roles see nothing; server code connects as the table owner.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

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
  created_at timestamptz not null default now(),
  unique (id, company_id),
  check (kind = 'live' or seed is not null)
);
create unique index one_live_world_per_company on worlds(company_id) where kind = 'live';

-- ─── Structure ──────────────────────────────────────────────────────

create table sites (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  unique (world_id, name)
);

create table rooms (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  site_id uuid not null,
  name text not null,
  department text not null,
  room_type text not null check (room_type in ('cleanroom','lab','office','storage','shipping','other')),
  cleanliness_class text not null default 'unclassified'
    check (cleanliness_class in ('grade_a','grade_b','grade_c','grade_d','unclassified')),
  status text not null default 'clear' check (status in ('clear','watch','at_risk','critical','locked')),
  layout jsonb,                                  -- voxel placement: {x, y, w, d}
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, site_id) references sites(world_id, id),
  unique (world_id, site_id, name)
);

create table production_lines (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  room_id uuid not null,
  name text not null,
  status text not null default 'running' check (status in ('running','halted','changeover')),
  units_per_hour integer not null check (units_per_hour > 0),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, room_id) references rooms(world_id, id)
);

create table equipment (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  room_id uuid not null,
  line_id uuid,                                  -- set when the equipment belongs to a line
  name text not null,
  equipment_type text not null,
  status text not null default 'running' check (status in ('running','halted','maintenance','failed')),
  last_maintenance_at timestamptz,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, room_id) references rooms(world_id, id),
  foreign key (world_id, line_id) references production_lines(world_id, id)
);

-- ─── Materials, products, batches ───────────────────────────────────

create table suppliers (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  country text,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id)
);

create table materials (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id)
);

create table material_suppliers (
  world_id uuid not null,
  company_id uuid not null,
  material_id uuid not null,
  supplier_id uuid not null,
  approved boolean not null default false,
  lead_time_days integer,
  primary key (world_id, material_id, supplier_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, material_id) references materials(world_id, id),
  foreign key (world_id, supplier_id) references suppliers(world_id, id)
);

create table material_lots (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  material_id uuid not null,
  supplier_id uuid,
  lot_code text not null,
  received_at timestamptz,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, material_id) references materials(world_id, id),
  foreign key (world_id, supplier_id) references suppliers(world_id, id),
  unique (world_id, lot_code)
);

create table products (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  storage_condition text not null check (storage_condition in ('ambient','refrigerated','frozen','ultra_cold')),
  release_test_days integer not null default 14,  -- realism: see docs/DOMAIN.md
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id)
);

create table batches (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  line_id uuid,
  batch_code text not null,
  status text not null check (status in ('in_production','in_testing','released','quarantined','rejected')),
  produced_at timestamptz,
  quantity integer not null check (quantity >= 0),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, product_id) references products(world_id, id),
  foreign key (world_id, line_id) references production_lines(world_id, id),
  unique (world_id, batch_code)
);

-- Impact graph edges
create table batch_equipment_usage (
  world_id uuid not null,
  company_id uuid not null,
  batch_id uuid not null,
  equipment_id uuid not null,
  primary key (world_id, batch_id, equipment_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, batch_id) references batches(world_id, id),
  foreign key (world_id, equipment_id) references equipment(world_id, id)
);
create index beu_by_equipment on batch_equipment_usage(world_id, equipment_id);

create table batch_material_usage (
  world_id uuid not null,
  company_id uuid not null,
  batch_id uuid not null,
  material_lot_id uuid not null,
  primary key (world_id, batch_id, material_lot_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, batch_id) references batches(world_id, id),
  foreign key (world_id, material_lot_id) references material_lots(world_id, id)
);
create index bmu_by_lot on batch_material_usage(world_id, material_lot_id);

-- ─── Stock, orders, shipments ───────────────────────────────────────

create table locations (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('warehouse_bay','distribution_center','trial_site','customer','dock')),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  unique (world_id, name)
);

create table inventory_lots (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  batch_id uuid not null,
  location_id uuid not null,
  quantity integer not null check (quantity >= 0),
  on_hold boolean not null default false,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, batch_id) references batches(world_id, id),
  foreign key (world_id, location_id) references locations(world_id, id)
);
create index inventory_by_batch on inventory_lots(world_id, batch_id);

create table orders (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  order_code text not null,
  product_id uuid not null,
  destination_id uuid not null,
  quantity integer not null check (quantity > 0),
  due_at timestamptz not null,
  priority text not null check (priority in ('routine','high','patient_critical')),
  status text not null default 'open' check (status in ('open','allocated','shipped','delivered','at_risk','cancelled')),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, product_id) references products(world_id, id),
  foreign key (world_id, destination_id) references locations(world_id, id),
  unique (world_id, order_code)
);
create index orders_by_due on orders(world_id, due_at);

create table shipments (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  shipment_code text not null,
  origin_id uuid,
  destination_id uuid,
  order_id uuid,
  carrier text,
  status text not null check (status in ('planned','at_dock','in_transit','held','delivered')),
  storage_condition text not null check (storage_condition in ('ambient','refrigerated','frozen','ultra_cold')),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, origin_id) references locations(world_id, id),
  foreign key (world_id, destination_id) references locations(world_id, id),
  foreign key (world_id, order_id) references orders(world_id, id),
  unique (world_id, shipment_code)
);
create index shipments_by_order on shipments(world_id, order_id);

create table shipment_items (
  world_id uuid not null,
  company_id uuid not null,
  shipment_id uuid not null,
  inventory_lot_id uuid not null,
  quantity integer not null check (quantity > 0),
  primary key (world_id, shipment_id, inventory_lot_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, shipment_id) references shipments(world_id, id),
  foreign key (world_id, inventory_lot_id) references inventory_lots(world_id, id)
);
create index shipment_items_by_lot on shipment_items(world_id, inventory_lot_id);

create table sensor_readings (
  world_id uuid not null,
  company_id uuid not null,
  id bigint generated by default as identity,
  subject_table text not null check (subject_table in ('rooms','equipment','shipments')),
  subject_id uuid not null,
  metric text not null,                          -- 'em_cfu', 'temp_c', 'humidity_pct', ...
  value numeric not null,
  recorded_at timestamptz not null,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id)
);
create index sensor_by_subject on sensor_readings(world_id, subject_id, metric, recorded_at desc);

-- ─── People and records ─────────────────────────────────────────────

create table people (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  site_id uuid,
  name text not null,
  role text not null,
  shift text check (shift in ('day','night','office')),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, site_id) references sites(world_id, id)
);

create table records (                           -- maintenance logs, cleaning records, SOPs, test results
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  record_type text not null check (record_type in ('maintenance','cleaning','sop','test_result','batch_record')),
  subject_table text,
  subject_id uuid,
  title text not null,
  body text not null,
  recorded_at timestamptz,
  embedding extensions.vector(1024),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id)
);
create index records_by_subject on records(world_id, subject_id, record_type, recorded_at);

-- ─── Incidents and the audit trail ──────────────────────────────────

create table incidents (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  code text not null,                            -- e.g. DEV-0412
  title text not null,
  incident_type text not null,
  severity text not null check (severity in ('info','watch','warning','critical')),
  priority integer not null default 50,
  status text not null default 'open' check (status in ('open','paused','contained','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  unique (world_id, code)
);
create index incidents_by_status on incidents(world_id, status);

create table incident_events (                   -- append-only timeline
  world_id uuid not null,
  company_id uuid not null,
  id bigint generated by default as identity,
  incident_id uuid not null,
  actor_type text not null check (actor_type in ('agent','human','watcher','system','saboteur')),
  actor_id text not null,
  seat text,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id)
);
create index events_by_incident on incident_events(world_id, incident_id, created_at);

create table seats (
  world_id uuid not null,
  company_id uuid not null,
  incident_id uuid not null,
  role text not null check (role in ('qa_director','plant_manager','supply_chain_lead','regulatory_affairs',
                                     'clinical_ops','executive','strategy_growth','observer','facilitator')),
  person_id uuid,                                -- null = AI playing
  primary key (world_id, incident_id, role),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id),
  foreign key (world_id, person_id) references people(world_id, id)
);

create table evidence (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid not null,
  source_table text not null,
  source_id text,                                -- text: sensor_readings ids are bigint
  added_by_type text not null check (added_by_type in ('agent','human')),
  added_by text not null,
  note text not null,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id)
);
create index evidence_by_incident on evidence(world_id, incident_id, created_at);

create table tasks (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid not null,
  title text not null,
  owner_seat text,
  status text not null default 'open' check (status in ('open','done','blocked')),
  due_at timestamptz,
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id)
);
create index tasks_by_incident on tasks(world_id, incident_id);

create table agent_configs (
  id text primary key,                           -- e.g. 'root_cause_analyst'
  config jsonb not null,                         -- validated against AgentConfig (src/agents/contract.ts)
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table agent_runs (                        -- append-only
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid,
  agent_id text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,4),
  latency_ms integer,
  status text not null check (status in ('ok','retried','invalid','budget_exceeded','error')),
  trace_id text,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id)
);
create index agent_runs_by_incident on agent_runs(world_id, incident_id, created_at);

create table decision_records (                  -- append-only
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid not null,
  agent_run_id uuid,
  agent_id text not null,
  record jsonb not null,                         -- validated DecisionRecord
  requires_approval boolean not null,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id),
  foreign key (world_id, agent_run_id) references agent_runs(world_id, id)
);
create index decisions_by_incident on decision_records(world_id, incident_id, created_at);

create table approvals (                         -- append-only
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  decision_record_id uuid not null,
  seat text not null,
  person_id uuid,                                -- null only in drill worlds (AI seat); see trigger
  outcome text not null check (outcome in ('approved','rejected','override','more_evidence')),
  reason text,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, decision_record_id) references decision_records(world_id, id),
  foreign key (world_id, person_id) references people(world_id, id)
);
create index approvals_by_decision on approvals(world_id, decision_record_id);

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

create table hidden_truths (                     -- readable only by the auditor's end-of-drill step
  scenario_id uuid primary key references scenarios(id),
  truth jsonb not null
);

create table drill_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id),
  world_id uuid not null unique references worlds(id),
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

-- ─── Impact graph views ─────────────────────────────────────────────
-- security_invoker so the views obey the caller's RLS instead of the owner's.

-- Directed edges along which a problem can spread. Usage edges go both ways (a shared lot or
-- machine links batches to each other); distribution edges go downstream only.
create view impact_edges with (security_invoker = true) as
  select world_id, 'rooms'::text as from_table, room_id as from_id, 'equipment'::text as to_table, id as to_id, 'located_in'::text as via
    from equipment
  union all
  select world_id, 'equipment', equipment_id, 'batches', batch_id, 'used_equipment' from batch_equipment_usage
  union all
  select world_id, 'batches', batch_id, 'equipment', equipment_id, 'used_equipment' from batch_equipment_usage
  union all
  select world_id, 'material_lots', material_lot_id, 'batches', batch_id, 'used_material_lot' from batch_material_usage
  union all
  select world_id, 'batches', batch_id, 'material_lots', material_lot_id, 'used_material_lot' from batch_material_usage
  union all
  select world_id, 'batches', batch_id, 'inventory_lots', id, 'stocked_as' from inventory_lots
  union all
  select world_id, 'inventory_lots', inventory_lot_id, 'shipments', shipment_id, 'shipped_in' from shipment_items
  union all
  select world_id, 'shipments', id, 'orders', order_id, 'fulfils' from shipments where order_id is not null
  union all
  select world_id, 'shipments', id, 'locations', destination_id, 'shipped_to' from shipments where destination_id is not null
  union all
  select world_id, 'orders', id, 'locations', destination_id, 'ordered_for' from orders;

-- One readable label and status per graph node, so traces can be shown and cited.
create view twin_nodes with (security_invoker = true) as
  select world_id, 'rooms'::text as node_table, id as node_id, name as label, status from rooms
  union all
  select world_id, 'equipment', id, name, status from equipment
  union all
  select world_id, 'material_lots', id, lot_code, null from material_lots
  union all
  select world_id, 'batches', id, batch_code, status from batches
  union all
  select i.world_id, 'inventory_lots', i.id, b.batch_code || ' @ ' || l.name,
         case when i.on_hold then 'on_hold' else 'available' end
    from inventory_lots i
    join batches b on b.world_id = i.world_id and b.id = i.batch_id
    join locations l on l.world_id = i.world_id and l.id = i.location_id
  union all
  select world_id, 'shipments', id, shipment_code, status from shipments
  union all
  select world_id, 'orders', id, order_code, status from orders
  union all
  select world_id, 'locations', id, name, kind from locations;

-- ─── Integrity triggers ─────────────────────────────────────────────

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; insert a new row instead', tg_table_name;
end;
$$;

create trigger incident_events_append_only before update or delete on incident_events
  for each row execute function forbid_mutation();
create trigger incident_events_no_truncate before truncate on incident_events
  for each statement execute function forbid_mutation();
create trigger decision_records_append_only before update or delete on decision_records
  for each row execute function forbid_mutation();
create trigger decision_records_no_truncate before truncate on decision_records
  for each statement execute function forbid_mutation();
create trigger approvals_append_only before update or delete on approvals
  for each row execute function forbid_mutation();
create trigger approvals_no_truncate before truncate on approvals
  for each statement execute function forbid_mutation();
create trigger agent_runs_append_only before update or delete on agent_runs
  for each row execute function forbid_mutation();
create trigger agent_runs_no_truncate before truncate on agent_runs
  for each statement execute function forbid_mutation();

-- Principle 1: in a live world every approval comes from a person. AI seats approve only in drills.
create function require_human_approval_in_live() returns trigger language plpgsql as $$
begin
  if new.person_id is null and (select kind from worlds where id = new.world_id) <> 'drill' then
    raise exception 'Approvals in a live world must be made by a person (person_id is required)';
  end if;
  return new;
end;
$$;

create trigger approvals_human_in_live before insert on approvals
  for each row execute function require_human_approval_in_live();

-- ─── Row Level Security ─────────────────────────────────────────────
-- Deny by default. Per-company policies arrive with Supabase Auth (Phase 4).

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Belt and braces for the one table nobody but the end-of-drill auditor step may read.
revoke all on hidden_truths from anon, authenticated;
