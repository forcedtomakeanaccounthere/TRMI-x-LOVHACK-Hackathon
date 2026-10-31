-- PDF freehand drawings and pen annotations.
-- Saved per room and page, broadcast over Realtime to all participants.

create table drawings (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  page_num int not null check (page_num >= 1),
  author_name text not null check (char_length(author_name) between 1 and 40 and author_name ~ '[^[:space:]]'),
  author_color text not null check (author_color ~ '^#[0-9a-fA-F]{6}$'),
  path_data jsonb not null check (jsonb_typeof(path_data) = 'object'),
  created_at timestamptz not null default now()
);

create index drawings_room_id_page_num_idx on drawings (room_id, page_num);

alter table drawings enable row level security;

create policy "public read" on drawings for select using (true);
create policy "public insert" on drawings for insert with check (true);
create policy "public delete" on drawings for delete using (true);

alter publication supabase_realtime add table drawings;
