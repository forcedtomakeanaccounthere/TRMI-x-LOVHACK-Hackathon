create table rooms (
  id text primary key,                 -- nanoid(8)
  kind text not null check (kind in ('link','pdf')),
  source_url text,
  title text,
  content_html text,                   -- link rooms: sanitized HTML with data-block IDs
  pdf_path text,                       -- pdf rooms: Supabase Storage path
  created_at timestamptz default now()
);

create table highlights (
  id uuid primary key default gen_random_uuid(),
  room_id text references rooms(id) on delete cascade,
  author_name text not null,
  author_color text not null,
  block_id text not null,              -- link: "b12" | pdf: "p3"
  start_offset int not null,
  end_offset int not null,
  quote text not null,
  created_at timestamptz default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  room_id text references rooms(id) on delete cascade,
  highlight_id uuid references highlights(id) on delete cascade,
  author_name text not null,
  author_color text not null,
  body text not null,
  created_at timestamptz default now()
);

create table recaps (
  id uuid primary key default gen_random_uuid(),
  room_id text references rooms(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz default now()
);

create index on highlights (room_id);
create index on comments (room_id);
create index on recaps (room_id);

alter publication supabase_realtime add table highlights, comments, recaps;

-- Hackathon RLS: anyone can read everything and insert highlights/comments.
-- Rooms and recaps are written only by apps/backend with the service role key.
alter table rooms enable row level security;
alter table highlights enable row level security;
alter table comments enable row level security;
alter table recaps enable row level security;

create policy "public read" on rooms for select using (true);
create policy "public read" on highlights for select using (true);
create policy "public read" on comments for select using (true);
create policy "public read" on recaps for select using (true);
create policy "public insert" on highlights for insert with check (true);
create policy "public insert" on comments for insert with check (true);

-- PDF storage bucket (public read so react-pdf can load files by URL).
-- 20 MB and PDF-only, matching the upload limit in apps/backend/src/routes/rooms.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', true, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
