-- The other documents attached to a room workspace (the Sources rail), kept by the backend so they
-- don't depend on a peer being online. Each attachment is another room, so extraction, highlights
-- and indexing work unchanged. (CHECKLIST called this room_sources; that name already holds YouTube
-- transcripts, see 0013_room_sources.sql.)
-- Written and read only by apps/backend: RLS on, no policies.

create table room_attachments (
  room_id text not null,
  source_room_id text not null,
  added_by uuid references auth.users(id) on delete set null,
  added_by_name text check (char_length(added_by_name) between 1 and 40),
  position int not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (room_id, source_room_id),
  constraint room_attachments_room_fkey foreign key (room_id) references rooms(id) on delete cascade,
  constraint room_attachments_source_fkey foreign key (source_room_id) references rooms(id) on delete cascade,
  constraint room_attachments_not_self check (room_id <> source_room_id)
);
create index room_attachments_source_idx on room_attachments (source_room_id);

alter table room_attachments enable row level security;
revoke all on room_attachments from anon, authenticated;
