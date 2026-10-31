-- The raw source a room was made from, when the room shows something else. A YouTube room shows
-- the detailed doc written from its transcript, so the transcript is kept here: its segments, and
-- the t{n} paragraphs (with their times) that chunks, citations and summaries point at.
-- Written and read only by apps/backend: RLS on, no policies.
create table room_sources (
  room_id text primary key references rooms(id) on delete cascade,
  data jsonb not null constraint room_sources_data_object check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);
alter table room_sources enable row level security;
