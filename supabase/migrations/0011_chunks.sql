-- Chunks and embeddings: each room's text split into ~400-token pieces that end on block boundaries,
-- for search, Q&A and summaries. Written only by apps/backend (lib/ai-jobs.ts) with the service role.

create extension if not exists vector with schema extensions;

create table chunks (
  id bigint generated always as identity primary key,
  room_id text not null references rooms(id) on delete cascade,
  idx int not null check (idx >= 0),                        -- order in the room
  content text not null check (char_length(content) between 1 and 4000),
  block_ids text[] not null check (cardinality(block_ids) >= 1),  -- the b{n} / p{n} / t{n} it covers
  page int check (page is null or page >= 1),               -- PDF page or slide of the first block
  heading_path text[] not null default '{}',                -- the h1-h3 headings it sits under
  start_sec numeric check (start_sec is null or start_sec >= 0),  -- video rooms (later)
  end_sec numeric check (end_sec is null or end_sec >= start_sec),
  -- EMBEDDING_DIM in apps/ai. Vectors from different models don't compare, so the model is kept and
  -- a room is re-indexed when the model changes. Null when embeddings were unavailable: the chunk
  -- is still found by keyword search.
  embedding extensions.vector(1024),
  embedding_model text,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (room_id, idx)
);

-- A room has a few hundred chunks at most, so a search reads all of its chunks exactly. An
-- approximate (HNSW) index over every room would filter by room after the search and could
-- return fewer than k chunks.
create index chunks_fts_idx on chunks using gin (fts);

-- The text of every room, so the browser can't query it directly: only apps/backend reads it.
alter table chunks enable row level security;

-- The k best chunks of a room for a question. Pass the question's embedding, its words, or both:
-- with both, the two rankings are merged (reciprocal rank fusion), so a chunk that matches either
-- way can come back. Without an embedding (embeddings unavailable), this is a keyword search.
create function public.match_chunks(
  p_room text,
  p_embedding extensions.vector(1024) default null,
  p_query text default null,
  p_k int default 8
)
returns table (
  id bigint,
  idx int,
  content text,
  block_ids text[],
  page int,
  heading_path text[],
  start_sec numeric,
  end_sec numeric,
  score double precision
)
language sql stable
set search_path = public, extensions
as $$
  with params as (
    select
      least(greatest(coalesce(p_k, 8), 1), 50) as k,
      -- Any of the words, not all of them: a question rarely repeats the document's exact wording.
      -- Built from plainto_tsquery, which never fails on punctuation or operators in the input.
      nullif(replace(plainto_tsquery('english', coalesce(p_query, ''))::text, ' & ', ' | '), '') as words
  ),
  semantic as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as rank
    from chunks c, params
    where p_embedding is not null and c.room_id = p_room and c.embedding is not null
    order by c.embedding <=> p_embedding
    limit (select k * 4 from params)
  ),
  keyword as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.query) desc, c.idx) as rank
    from chunks c, params, lateral (select params.words::tsquery as query) q
    where params.words is not null and c.room_id = p_room and c.fts @@ q.query
    order by ts_rank_cd(c.fts, q.query) desc, c.idx
    limit (select k * 4 from params)
  ),
  fused as (
    select coalesce(s.id, w.id) as id,
      coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + w.rank), 0) as score
    from semantic s
    full join keyword w on w.id = s.id
  )
  select c.id, c.idx, c.content, c.block_ids, c.page, c.heading_path, c.start_sec, c.end_sec,
    f.score::double precision
  from fused f
  join chunks c on c.id = f.id
  order by f.score desc, c.idx
  limit (select k from params);
$$;

-- Backend only, like the table.
revoke execute on function public.match_chunks(text, extensions.vector, text, int) from public, anon, authenticated;
grant execute on function public.match_chunks(text, extensions.vector, text, int) to service_role;

-- Every room is queued for indexing when it is created: its room_ai row starts as 'pending'. The
-- row is written with the room, so a backend restart before the job runs (or while it runs) can't
-- lose it: on startup apps/backend indexes every room still 'pending' or 'indexing'.
create function public.queue_room_ai() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into public.room_ai (room_id) values (new.id) on conflict (room_id) do nothing;
  return new;
end;
$$;

create trigger rooms_queue_ai
  after insert on rooms
  for each row execute function public.queue_room_ai();

-- Rooms made before this migration are queued too, so they get indexed on the next startup.
insert into room_ai (room_id) select id from rooms on conflict (room_id) do nothing;

-- The startup query: rooms left waiting, oldest first.
create index room_ai_waiting_idx on room_ai (created_at) where status in ('pending', 'indexing');
