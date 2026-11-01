-- AI foundation: three kinds of source (links, files, videos) turned into one format, a room's
-- AI state, and a private bucket for uploaded documents.

-- Room kinds. "rooms_kind_check" is the name Postgres gave the inline check in 0001_init.sql.
--   link     a web page or pasted text: sanitized HTML with b{n} blocks
--   pdf      a PDF in the pdfs bucket: one p{n} block per page
--   file     an uploaded DOCX, PPTX, Markdown or text file turned into HTML (b{n}, or p{n} per slide)
--   youtube  a video: transcript segments are t{n} blocks
alter table rooms drop constraint rooms_kind_check;
alter table rooms add constraint rooms_kind_check check (kind in ('link', 'pdf', 'file', 'youtube'));

-- Where an uploaded room came from, for example {"format": "docx", "file_name": "notes.docx"}.
alter table rooms
  add column source_meta jsonb
  constraint rooms_source_meta_object check (source_meta is null or jsonb_typeof(source_meta) = 'object');

-- Block anchors: b{n} paragraphs, p{n} pages or slides, t{n} transcript segments.
-- Matches block_id in packages/shared/src/schemas.ts.
alter table highlights drop constraint highlights_block_id_format;
alter table highlights add constraint highlights_block_id_format check (block_id ~ '^[bpt][0-9]{1,6}$');

-- A room's AI state: indexing (chunks and embeddings), then the detailed summary. Written only by
-- apps/backend with the service role; readable like the room itself, and sent over Realtime so the
-- page knows when the summary is ready.
create table room_ai (
  room_id text primary key references rooms(id) on delete cascade,
  status text not null default 'pending'
    constraint room_ai_status_check check (status in ('pending', 'indexing', 'summarizing', 'ready', 'failed')),
  summary jsonb,
  -- A short reason when status is 'failed'. Never document text.
  error text constraint room_ai_error_len check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.touch_room_ai() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger room_ai_touch
  before update on room_ai
  for each row execute function public.touch_room_ai();

alter table room_ai enable row level security;
create policy "public read" on room_ai for select
  using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'deleted'));

alter publication supabase_realtime add table room_ai;

-- Uploaded documents (POST /api/rooms/file). The room shows the HTML made from the file, so the
-- original is kept private: no policies, only apps/backend can reach it. 20 MB, like PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'files',
  'files',
  false,
  20971520,
  '{application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,text/markdown,text/plain}'
)
on conflict (id) do nothing;
