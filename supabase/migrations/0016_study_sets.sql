-- Study sets: a quiz, flashcards, a mind map or an infographic the AI made from one or more rooms.
-- Private like ai_queries: RLS on with no policies, so only apps/backend (service role) reads and writes.
create table study_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quiz', 'flashcards', 'mindmap', 'infographic')),
  title text not null check (char_length(title) between 1 and 200),
  -- The rooms it was made from. No foreign key: a set outlives a room deleted later.
  room_ids text[] not null check (cardinality(room_ids) between 1 and 20),
  focus text check (focus is null or char_length(focus) <= 200),
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index study_sets_user_id_created_at_idx on study_sets (user_id, created_at desc);

alter table study_sets enable row level security;
