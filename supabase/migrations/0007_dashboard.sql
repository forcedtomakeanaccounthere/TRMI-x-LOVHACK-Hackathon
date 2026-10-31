-- Dashboard: room lifecycle, groups, profiles, presence, follows, invites and AI history.
--
-- The dashboard is served entirely by apps/backend with the service role, so these tables have RLS
-- enabled and no policies: the browser reaches them through the API, never directly.

-- Rooms are filed into an owner's groups. Deleting a group leaves its rooms unfiled.
create table room_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name ~ '[^[:space:]]'),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);
create index on room_groups (owner_id, position);
alter table room_groups enable row level security;

-- Which project a room is filed in. This lives apart from rooms because anyone can read rooms with
-- the public key, and a project is private to its owner. A room is in at most one project.
create table room_group_items (
  room_id text primary key references rooms(id) on delete cascade,
  group_id uuid not null references room_groups(id) on delete cascade
);
create index on room_group_items (group_id);
alter table room_group_items enable row level security;

-- Lifecycle timestamps sit next to the status they describe. last_activity_at drives the "active"
-- sort and is kept current by the highlight/comment triggers below.
alter table rooms
  add column paused_at timestamptz,
  add column closed_at timestamptz,
  add column deleted_at timestamptz,
  add column last_activity_at timestamptz default now();
create index on rooms (last_activity_at desc);

-- Paused rooms are readable but, like closed ones, take no new highlights or comments.
alter table rooms drop constraint rooms_status_check;
alter table rooms add constraint rooms_status_check
  check (status in ('running', 'paused', 'closed', 'archived', 'deleted'));

-- One profile per account. The display name falls back to the name given at signup.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40 and display_name ~ '[^[:space:]]'),
  bio text check (bio is null or char_length(bio) <= 280),
  avatar_color text check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;

insert into profiles (id, display_name, created_at)
select
  id,
  coalesce(
    nullif(btrim(raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'Reader'
  ),
  created_at
from auth.users
on conflict (id) do nothing;

create function public.create_profile_for_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Reader'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_user();

-- Who has opened a room, and when they were last seen (the heartbeat that powers "live now").
create table room_participants (
  room_id text not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index on room_participants (user_id, last_seen_at desc);
create index on room_participants (room_id, last_seen_at desc);
alter table room_participants enable row level security;

-- Carry the old visit history over before dropping it.
insert into room_participants (room_id, user_id, joined_at, last_seen_at)
select room_id, user_id, last_opened_at, last_opened_at from room_visits
on conflict (room_id, user_id) do nothing;
drop table room_visits;

-- One row per directed follow. People can't follow themselves.
create table follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index on follows (followee_id);
alter table follows enable row level security;

-- A room owner can invite another account. Only one pending invite per room and person.
create table room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (inviter_id <> invitee_id)
);
create unique index room_invites_pending_key on room_invites (room_id, invitee_id) where status = 'pending';
create index on room_invites (invitee_id, created_at desc);
create index on room_invites (inviter_id, created_at desc);
alter table room_invites enable row level security;

-- Every AI request made in a room, so answers are auditable and can be shown again later.
create table ai_queries (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('recap', 'ask')),
  prompt text,
  response jsonb,
  created_at timestamptz not null default now()
);
create index on ai_queries (room_id, created_at desc);
alter table ai_queries enable row level security;

-- Keep last_activity_at current for every highlight and comment, whichever client wrote it.
create function public.touch_room_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set last_activity_at = now() where id = new.room_id;
  return new;
end;
$$;

create trigger highlights_touch_room
  after insert on highlights
  for each row execute function public.touch_room_activity();
create trigger comments_touch_room
  after insert on comments
  for each row execute function public.touch_room_activity();

-- Status timestamps are stamped in one place, so every write path agrees on what they mean.
create function public.stamp_room_status() returns trigger
language plpgsql as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'running' then
      new.paused_at := null;
      new.closed_at := null;
      new.deleted_at := null;
    when 'paused' then
      new.paused_at := now();
      new.closed_at := null;
    when 'closed' then
      new.paused_at := null;
      new.closed_at := now();
    when 'archived' then
      new.paused_at := null;
    when 'deleted' then
      new.deleted_at := coalesce(old.deleted_at, now());
    end case;

  return new;
end;
$$;

create trigger rooms_stamp_status
  before update of status on rooms
  for each row execute function public.stamp_room_status();

-- Backfill activity from the rows that already exist.
update rooms r
set last_activity_at = greatest(
  r.created_at,
  coalesce((select max(created_at) from highlights h where h.room_id = r.id), r.created_at),
  coalesce((select max(created_at) from comments c where c.room_id = r.id), r.created_at)
);
alter table rooms alter column last_activity_at set not null;

-- Saves a room's status and project together, so a failed move never leaves a status change behind.
-- Returns false, changing nothing, if the room is deleted or gone. It takes no owner: the API checks
-- that first, so only the service role may run it.
create function public.update_room(
  target_room text,
  new_status text,
  change_group boolean,
  new_group uuid
) returns boolean
language plpgsql set search_path = public as $$
begin
  if new_status is not null then
    update rooms set status = new_status where id = target_room and status <> 'deleted';
  else
    perform 1 from rooms where id = target_room and status <> 'deleted' for update;
  end if;
  if not found then
    return false;
  end if;

  if change_group and new_group is null then
    delete from room_group_items where room_id = target_room;
  elsif change_group then
    insert into room_group_items (room_id, group_id) values (target_room, new_group)
    on conflict (room_id) do update set group_id = excluded.group_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.update_room(text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.update_room(text, text, boolean, uuid) to service_role;
