-- Voice huddles (room-wide or private calls with LiveKit audio and captions) and AI huddle notes.
-- Written and read only by apps/backend (service role): RLS on, no policies.
-- Private-huddle content never goes into room_events.

create table huddles (
  id text primary key check (char_length(id) between 1 and 64),
  room_id text not null references rooms(id) on delete cascade,
  livekit_room text not null unique,
  audience text not null check (audience in ('all', 'private')),
  created_by text not null check (char_length(created_by) between 1 and 64),
  created_by_name text not null check (char_length(created_by_name) between 1 and 40),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes_status text not null check (notes_status in ('none', 'generating', 'ready', 'failed')) default 'none',
  notes_error text
);

-- At most one open room-wide huddle per room at any time.
create unique index huddles_open_all_idx on huddles (room_id)
  where audience = 'all' and ended_at is null;

create index huddles_room_started_idx on huddles (room_id, started_at desc);

create table huddle_members (
  huddle_id text not null references huddles(id) on delete cascade,
  member_id text not null check (char_length(member_id) between 1 and 64),
  name text not null check (char_length(name) between 1 and 40),
  invited_by text check (invited_by is null or char_length(invited_by) between 1 and 64),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (huddle_id, member_id)
);

create table huddle_segments (
  huddle_id text not null references huddles(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  seq bigint generated always as identity,
  speaker_id text not null check (char_length(speaker_id) between 1 and 64),
  speaker_name text not null check (char_length(speaker_name) between 1 and 40),
  text text not null check (char_length(text) between 1 and 1000),
  start_at timestamptz not null,
  end_at timestamptz not null,
  doc text,
  block text,
  primary key (huddle_id, id)
);

create unique index huddle_segments_huddle_seq_idx on huddle_segments (huddle_id, seq);

create function huddle_segments_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'huddle_segments is append-only' using errcode = '42501';
end;
$$;

create trigger huddle_segments_no_update before update on huddle_segments
  for each row execute function huddle_segments_append_only();

create table huddle_focus (
  huddle_id text not null references huddles(id) on delete cascade,
  member_id text not null check (char_length(member_id) between 1 and 64),
  doc text not null,
  block text not null,
  at timestamptz not null default now()
);

create index huddle_focus_huddle_at_idx on huddle_focus (huddle_id, at);

create table huddle_notes (
  huddle_id text not null references huddles(id) on delete cascade,
  version integer not null default 1,
  notes jsonb not null check (jsonb_typeof(notes) = 'object'),
  created_at timestamptz not null default now(),
  primary key (huddle_id, version)
);

alter table huddles enable row level security;
alter table huddle_members enable row level security;
alter table huddle_segments enable row level security;
alter table huddle_focus enable row level security;
alter table huddle_notes enable row level security;

revoke all on huddles, huddle_members, huddle_segments, huddle_focus, huddle_notes from anon, authenticated;
