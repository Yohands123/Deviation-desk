-- Transport lanes and versioned agent configs (Phase 3).

-- ─── Lanes ──────────────────────────────────────────────────────────
-- How long and how much it costs to move product between two locations. The Rerouter's optimizer
-- call uses these to decide which stock can reach an order in time.
create table lanes (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  origin_id uuid not null,
  destination_id uuid not null,
  storage_condition text not null check (storage_condition in ('ambient','refrigerated','frozen','ultra_cold')),
  transit_hours numeric not null check (transit_hours > 0),
  cost_per_unit numeric not null check (cost_per_unit >= 0),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, origin_id) references locations(world_id, id),
  foreign key (world_id, destination_id) references locations(world_id, id),
  unique (world_id, origin_id, destination_id, storage_condition),
  check (origin_id <> destination_id)
);
create index lanes_by_destination on lanes(world_id, destination_id);
alter table lanes enable row level security;

-- ─── Agent config history ───────────────────────────────────────────
-- agent_configs holds the current version of each agent; every version ever used is kept here so a
-- decision can always be traced to the exact prompt and limits that produced it.
create table agent_config_versions (
  agent_id text not null,
  version integer not null check (version > 0),
  config jsonb not null,
  created_at timestamptz not null default now(),
  primary key (agent_id, version)
);
alter table agent_config_versions enable row level security;

create trigger agent_config_versions_append_only before update or delete on agent_config_versions
  for each row execute function forbid_mutation();
create trigger agent_config_versions_no_truncate before truncate on agent_config_versions
  for each statement execute function forbid_mutation();

alter table agent_runs add column agent_config_version integer;
