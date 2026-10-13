-- Capacity and costs (Phase 7): what the Event Council, the Coordinator, the Scheduler and the
-- Trial Runner reason about. Arithmetic over these stays in code (CLAUDE.md principle 10).

alter table products add column unit_price_usd numeric(10, 2) not null default 0 check (unit_price_usd >= 0);

-- Shared resources and how long one job on each takes. Part of the twin, so drills get a copy.
--   fill_line       one batch per day per line (fill, changeover cleaning, EM)
--   sterility_test  concurrent incubator slots; a test occupies a slot for the product's test days
--   qa_release      batch record reviews QA can complete per day
--   dispatch        shipments the dock can send per day
create table capacity_resources (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('fill_line', 'sterility_test', 'qa_release', 'dispatch')),
  line_id uuid,
  capacity integer not null check (capacity > 0),
  capacity_basis text not null check (capacity_basis in ('per_day', 'concurrent')),
  task_hours integer not null check (task_hours > 0),
  notes text,
  primary key (world_id, id),
  unique (world_id, name),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, line_id) references production_lines(world_id, id)
);
create index capacity_by_kind on capacity_resources(world_id, kind);

alter table capacity_resources enable row level security;
create policy "company members read capacity" on capacity_resources
  for select to authenticated using (company_id in (select public.current_company_ids()));
