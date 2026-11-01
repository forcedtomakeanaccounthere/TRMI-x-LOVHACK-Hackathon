-- The room workspace's shared notebook: one collaborative document per room that everyone writes in
-- at once. Its content is a Yjs document; `state` holds it as one merged update (base64), so any
-- browser can load it and keep editing. Live edits travel over the room's Realtime channel; each
-- browser also sends its edits to apps/backend, which merges them in here.
-- `version` lets the backend merge without a lock: an update is written only if no other write
-- landed since it read the row, and is retried otherwise.
-- Written and read only by apps/backend (service role): RLS on, no policies.

create table room_notebooks (
  room_id text primary key references rooms(id) on delete cascade,
  state text not null check (char_length(state) <= 4000000),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table room_notebooks enable row level security;
revoke all on room_notebooks from anon, authenticated;
