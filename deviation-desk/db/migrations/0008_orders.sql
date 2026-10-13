-- Orders logged by people (Phase 7): who logged an order and when, so the Order Desk's checks and
-- the Scheduler's plans trace back to a person (CLAUDE.md §10: every human input has an author).
alter table orders
  add column logged_by uuid,
  add column logged_at timestamptz;
alter table orders add foreign key (world_id, logged_by) references people(world_id, id);
create index orders_by_logged on orders(world_id, logged_at desc) where logged_at is not null;
