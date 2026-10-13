-- Every decision on an agent lesson (approve, reject, retire), append-only (CLAUDE.md principle 4).
-- agent_lessons.status is the current state; this table is its history.
create table agent_lesson_decisions (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  lesson_id uuid not null,
  person_id uuid not null,
  seat text not null check (seat in ('qa_director', 'executive')),
  outcome text not null check (outcome in ('active', 'rejected', 'retired')),
  reason text,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, lesson_id) references agent_lessons(world_id, id),
  foreign key (world_id, person_id) references people(world_id, id)
);
create trigger agent_lesson_decisions_append_only before update or delete on agent_lesson_decisions
  for each row execute function forbid_mutation();
alter table agent_lesson_decisions enable row level security;
create policy "company members read lesson decisions" on agent_lesson_decisions
  for select to authenticated using (company_id in (select public.current_company_ids()));
