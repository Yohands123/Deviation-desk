-- Regulatory and communications (Phase 7): contacts, the regulatory library, confirmed reporting
-- obligations, and the outbox for approved messages.

-- ─── Contacts ───────────────────────────────────────────────────────
-- Who messages go to. Part of the twin, so drills get a copy (messages from drills never leave).
create table contacts (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  name text not null,
  organization text not null,
  kind text not null check (kind in ('customer', 'trial_site', 'supplier', 'internal', 'regulator')),
  role text not null,
  email text not null,
  location_id uuid,
  supplier_id uuid,
  primary key (world_id, id),
  unique (world_id, email),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, location_id) references locations(world_id, id),
  foreign key (world_id, supplier_id) references suppliers(world_id, id)
);
create index contacts_by_kind on contacts(world_id, kind);
create index contacts_by_location on contacts(world_id, location_id);
create index contacts_by_supplier on contacts(world_id, supplier_id);

-- ─── Regulatory library ─────────────────────────────────────────────
-- Reporting rules the Regulator agents search. The demo library is fictional (`fictional`), so
-- nothing here may be read as legal advice. Deadlines are hours from when the clock starts:
-- when the company became aware (the incident opened) or when Regulatory Affairs confirmed it.
create table regulatory_rules (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  code text not null,
  authority text not null,
  title text not null,
  applies_to text not null check (applies_to in ('all', 'biologic', 'device', 'clinical', 'distribution')),
  applies_when text not null,
  deadline_hours integer not null check (deadline_hours > 0),
  clock_starts text not null check (clock_starts in ('awareness', 'confirmation')),
  required_documents text[] not null default '{}',
  body text not null,
  fictional boolean not null default true,
  primary key (world_id, id),
  unique (world_id, code),
  foreign key (world_id, company_id) references worlds(id, company_id)
);

-- ─── Confirmed obligations ──────────────────────────────────────────
-- Written only by the executor, after Regulatory Affairs approves Regulator B's proposal.
create table regulatory_obligations (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid not null,
  rule_id uuid not null,
  decision_record_id uuid not null,
  approval_id uuid not null,
  clock_started_at timestamptz not null,
  due_at timestamptz not null,
  task_id uuid,
  submitted_message_id uuid,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  unique (world_id, incident_id, rule_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id),
  foreign key (world_id, rule_id) references regulatory_rules(world_id, id),
  foreign key (world_id, decision_record_id) references decision_records(world_id, id),
  foreign key (world_id, approval_id) references approvals(world_id, id),
  foreign key (world_id, task_id) references tasks(world_id, id)
);
create index obligations_by_incident on regulatory_obligations(world_id, incident_id, due_at);

-- ─── Outbox ─────────────────────────────────────────────────────────
-- Every approved message, exactly as approved. Content never changes after insert; only delivery
-- fields move. Messages in drill worlds are recorded and never sent (status 'drill').
create table outbound_messages (
  world_id uuid not null,
  company_id uuid not null,
  id uuid not null default gen_random_uuid(),
  incident_id uuid not null,
  decision_record_id uuid not null,
  approval_id uuid not null,
  action_type text not null,
  audience text not null check (audience in ('customer', 'trial_site', 'supplier', 'internal', 'regulator')),
  recipients jsonb not null,
  subject text not null,
  body text not null,
  status text not null default 'ready' check (status in ('ready', 'sent', 'failed', 'not_configured', 'drill')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (world_id, id),
  unique (world_id, decision_record_id),
  foreign key (world_id, company_id) references worlds(id, company_id),
  foreign key (world_id, incident_id) references incidents(world_id, id),
  foreign key (world_id, decision_record_id) references decision_records(world_id, id),
  foreign key (world_id, approval_id) references approvals(world_id, id)
);
create index outbound_by_incident on outbound_messages(world_id, incident_id, created_at);
create index outbound_by_status on outbound_messages(status) where status = 'ready';

alter table regulatory_obligations
  add foreign key (world_id, submitted_message_id) references outbound_messages(world_id, id);

create function outbound_content_frozen() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outbound_messages is append-only';
  end if;
  if (new.world_id, new.company_id, new.id, new.incident_id, new.decision_record_id, new.approval_id,
      new.action_type, new.audience, new.recipients, new.subject, new.body, new.created_at)
     is distinct from
     (old.world_id, old.company_id, old.id, old.incident_id, old.decision_record_id, old.approval_id,
      old.action_type, old.audience, old.recipients, old.subject, old.body, old.created_at) then
    raise exception 'An approved message cannot be changed; only its delivery status can.';
  end if;
  return new;
end;
$$;
create trigger outbound_messages_frozen before update or delete on outbound_messages
  for each row execute function outbound_content_frozen();
create trigger outbound_messages_no_truncate before truncate on outbound_messages
  for each statement execute function forbid_mutation();

-- ─── Row level security ─────────────────────────────────────────────
alter table contacts enable row level security;
alter table regulatory_rules enable row level security;
alter table regulatory_obligations enable row level security;
alter table outbound_messages enable row level security;
create policy "company members read contacts" on contacts
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read regulatory rules" on regulatory_rules
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read obligations" on regulatory_obligations
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read outbound messages" on outbound_messages
  for select to authenticated using (company_id in (select public.current_company_ids()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table regulatory_obligations, outbound_messages;
  end if;
end;
$$;
