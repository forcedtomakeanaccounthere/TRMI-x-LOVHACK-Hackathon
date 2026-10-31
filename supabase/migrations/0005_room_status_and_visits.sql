-- Dashboard: every room has a lifecycle, and logged-in users' visits are remembered.
--   running   open to everyone with the link (the default)
--   closed    the owner ended the session: readable, no new highlights or comments
--   archived  filed away by the owner: readable, no new highlights, comments or recaps
--   deleted   soft delete: invisible to everyone but the owner, who can restore it
alter table rooms
  add column status text not null default 'running'
  check (status in ('running', 'closed', 'archived', 'deleted'));

-- Rooms a logged-in user has opened. Guests have no account, so they leave no row.
-- Written only by apps/backend: RLS is on with no policies.
create table room_visits (
  room_id text not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_opened_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on room_visits (user_id, last_opened_at desc);
alter table room_visits enable row level security;

-- Public bucket URLs skip RLS, so a deleted room's PDF waits here, in a private bucket, until it is
-- restored. Only apps/backend can reach it: there are no policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs-deleted', 'pdfs-deleted', false, 20971520, '{application/pdf}')
on conflict (id) do nothing;

-- Deleted rooms disappear for the anon key, along with everything inside them.
drop policy "public read" on rooms;
drop policy "public read" on highlights;
drop policy "public read" on comments;
drop policy "public read" on recaps;
drop policy "public insert" on highlights;
drop policy "public insert" on comments;

create policy "public read" on rooms for select using (status <> 'deleted');
create policy "public read" on highlights for select
  using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'deleted'));
create policy "public read" on comments for select
  using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'deleted'));
create policy "public read" on recaps for select
  using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'deleted'));

-- Only running rooms take new highlights and comments, whatever the client does.
create policy "public insert" on highlights for insert
  with check (exists (select 1 from rooms r where r.id = room_id and r.status = 'running'));
create policy "public insert" on comments for insert
  with check (exists (select 1 from rooms r where r.id = room_id and r.status = 'running'));
