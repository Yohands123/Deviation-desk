-- Sign-in and realtime for the Incident Room (Phase 4).
--
-- People are linked to Supabase Auth users. The browser reads incident rows over Realtime with the
-- signed-in user's token, so those tables get read-only policies scoped to the user's company.
-- Every write still goes through server code (DATABASE_URL), which checks seats and permissions.

alter table people add column auth_user_id uuid;
create index people_by_auth_user on people(auth_user_id) where auth_user_id is not null;

-- Companies the signed-in user belongs to. Security definer so policies can read `people`, which
-- has no policies of its own and stays invisible to the API roles.
create function public.current_company_ids() returns setof uuid
  language sql stable security definer set search_path = ''
as $$
  select distinct p.company_id from public.people p where p.auth_user_id = auth.uid()
$$;
revoke all on function public.current_company_ids() from public;
grant execute on function public.current_company_ids() to authenticated;

create policy "company members read incidents" on incidents
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read incident events" on incident_events
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read decision records" on decision_records
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read approvals" on approvals
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read evidence" on evidence
  for select to authenticated using (company_id in (select public.current_company_ids()));
create policy "company members read seats" on seats
  for select to authenticated using (company_id in (select public.current_company_ids()));

-- Stream changes on the incident tables (Supabase's realtime publication; absent elsewhere).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table incident_events, decision_records, approvals, evidence, seats;
  end if;
end;
$$;
