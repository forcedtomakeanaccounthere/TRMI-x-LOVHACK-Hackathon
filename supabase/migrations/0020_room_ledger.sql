-- The room workspace's ledger, kept by the backend so a room no longer depends on a peer being online
-- (CHECKLIST "Link rooms workspace"). Every change to a room is one event in room_events, never
-- edited: annotations, notes, AI threads, discussion, artifacts, attached documents, roles, kicks and
-- settings. The History panel lists them as they are. room_members and room_settings are kept from
-- those events so apps/backend can check each new one against the writer's role and kicks.
-- Written and read only by apps/backend (service role): RLS on, no policies.

create table room_events (
  room_id text not null references rooms(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_:-]{1,64}$'), -- made by the browser, so retries are safe
  seq bigint generated always as identity, -- the order the backend accepted them in
  type text not null check (type in (
    'doc.add', 'doc.remove', 'annot.add', 'annot.remove', 'note.edit', 'thread.ask', 'thread.answer',
    'chat', 'artifact.add', 'artifact.remove', 'role.set', 'member.kick', 'settings.update'
  )),
  actor_id text not null check (char_length(actor_id) between 1 and 64),
  actor_name text not null check (char_length(actor_name) between 1 and 40),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), -- the whole event
  at timestamptz not null, -- when the browser made it
  created_at timestamptz not null default now(),
  primary key (room_id, id)
);
create unique index room_events_room_seq_idx on room_events (room_id, seq);
-- "Who added this annotation / artifact / document": the author check for removals.
create index room_events_added_idx on room_events (room_id, type, (coalesce(
  payload #>> '{annotation,id}', payload #>> '{artifact,id}', payload #>> '{doc,id}'
)));

-- Append-only: an event is never changed. Deleting a room still removes its events (cascade).
create function room_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'room_events is append-only' using errcode = '42501';
end;
$$;
create trigger room_events_no_update before update on room_events
  for each row execute function room_events_append_only();

alter table room_events enable row level security;

-- One row per person who has written to the room, or been given a role or removed.
-- member_id is the account id of a signed-in person, or the guest id their browser made.
create table room_members (
  room_id text not null references rooms(id) on delete cascade,
  member_id text not null check (char_length(member_id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 40),
  role text check (role in ('admin', 'editor', 'viewer')), -- null: the room's default applies
  kicked_at timestamptz,
  key_hash text check (key_hash ~ '^[0-9a-f]{64}$'), -- sha256 of a guest's key; null for accounts
  first_seen_at timestamptz not null default now(),
  primary key (room_id, member_id)
);
alter table room_members enable row level security;

create table room_settings (
  room_id text primary key references rooms(id) on delete cascade,
  allow_guests boolean not null default true,
  guest_role text not null default 'editor' check (guest_role in ('viewer', 'editor')),
  member_role text not null default 'editor' check (member_role in ('viewer', 'editor')),
  viewers_use_ai boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table room_settings enable row level security;

revoke all on room_events, room_members, room_settings from anon, authenticated;
