-- Expansion and learning (Phase 7): growth proposals with what-if simulations and human decisions,
-- standing decision rights outside incidents, and lessons agents learn only with human approval.

-- ─── Standing seats ─────────────────────────────────────────────────
-- The seat a person holds outside any incident. Decisions that do not belong to an incident
-- (expansion, agent lessons) are checked against it on the server.
alter table people add column standing_seat text check (standing_seat in
  ('qa_director', 'plant_manager', 'supply_chain_lead', 'regulatory_affairs', 'clinical_ops', 'executive', 'strategy_growth'));

-- ─── Investment price list ──────────────────────────────────────────
-- What each kind of change costs and how long it takes. Code computes a proposal's cost from it.
create table investment_options (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('fill_line', 'test_capacity', 'qa_capacity', 'backup_supplier', 'distribution_center')),
  description text not null,
  unit text not null,
  unit_cost_usd numeric(14, 2) not null check (unit_cost_usd >= 0),
  lead_time_months integer not null check (lead_time_months >= 0),
  primary key (world_id, id),
  unique (world_id, kind),
  foreign key (world_id, company_id) references worlds(id, company_id)
);

-- ─── Expansion proposals ────────────────────────────────────────────
create table expansion_proposals (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  code text not null,
  kind text not null check (kind in ('fill_line', 'test_capacity', 'qa_capacity', 'backup_supplier', 'distribution_center')),
  title text not null,
  summary text not null,
  change jsonb not null,
  estimated_cost_usd numeric(14, 2) not null,
  lead_time_months integer not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  proposed_by text not null,
  decision_record_id uuid,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  unique (world_id, code),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, decision_record_id) references decision_records(world_id, id)
);

-- What-if results: the same stress tests on a copy of the company as it is and with the change.
create table expansion_simulations (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  proposal_id uuid not null,
  baseline jsonb not null,
  with_change jsonb not null,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, proposal_id) references expansion_proposals(world_id, id)
);
create index simulations_by_proposal on expansion_simulations(world_id, proposal_id, created_at desc);

-- People's decisions on proposals. Strategy & Growth decides; spend at or above the threshold also
-- needs the Executive (src/expansion/decisions.ts).
create table expansion_decisions (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  proposal_id uuid not null,
  person_id uuid not null,
  seat text not null check (seat in ('strategy_growth', 'executive')),
  outcome text not null check (outcome in ('approved', 'rejected')),
  reason text,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, proposal_id) references expansion_proposals(world_id, id),
  foreign key (world_id, person_id) references people(world_id, id)
);

-- ─── Agent lessons (the Learning Loop) ──────────────────────────────
-- A lesson is appended to one agent's prompt for one company, only after a person approves it.
-- The reviewed defaults in registry.ts never change; lessons sit beside them.
create table agent_lessons (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  agent_id text not null references agent_configs(id),
  lesson text not null,
  rationale text not null,
  evidence jsonb not null default '[]',
  decision_record_id uuid not null,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'rejected', 'retired')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, decision_record_id) references decision_records(world_id, id),
  foreign key (world_id, decided_by) references people(world_id, id)
);
create index lessons_by_agent on agent_lessons(world_id, agent_id, status);

create trigger expansion_simulations_append_only before update or delete on expansion_simulations
  for each row execute function forbid_mutation();
create trigger expansion_decisions_append_only before update or delete on expansion_decisions
  for each row execute function forbid_mutation();

-- ─── Row level security ─────────────────────────────────────────────
alter table investment_options enable row level security;
alter table expansion_proposals enable row level security;
alter table expansion_simulations enable row level security;
alter table expansion_decisions enable row level security;
alter table agent_lessons enable row level security;
create policy "company members read investment options" on investment_options
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read expansion proposals" on expansion_proposals
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read expansion simulations" on expansion_simulations
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read expansion decisions" on expansion_decisions
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read agent lessons" on agent_lessons
  for select to authenticated using (company_id in (select public.current_company_ids()));
