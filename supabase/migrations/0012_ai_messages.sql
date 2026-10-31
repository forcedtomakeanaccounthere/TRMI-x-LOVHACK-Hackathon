-- "Ask the room": questions about a room's document and the AI's answers, with citations. Everyone
-- in the room sees each answer: the rows are readable like the room and sent over Realtime. Only
-- apps/backend writes them (POST /api/rooms/:id/ask), after checking every citation.
create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  -- ask: a question typed in the room. explain: "explain this highlight" (later).
  kind text not null default 'ask' constraint ai_messages_kind_check check (kind in ('ask', 'explain')),
  -- The name shown with the question, like recaps.requested_by; null when none was given.
  asked_by text constraint ai_messages_asked_by_check
    check (asked_by is null or (char_length(asked_by) between 1 and 40 and asked_by ~ '[^[:space:]]')),
  question text not null constraint ai_messages_question_len check (char_length(question) between 1 and 500),
  answer text not null constraint ai_messages_answer_len check (char_length(answer) between 1 and 4000),
  -- False when the document doesn't answer the question; the answer then says so.
  found_in_document boolean not null,
  -- [{ "quote", "block_ids", "page", "start_sec", "end_sec" }], each checked against its chunk.
  -- Pages and times come from the chunks, never from the model.
  citations jsonb not null default '[]'
    constraint ai_messages_citations_array check (jsonb_typeof(citations) = 'array'),
  created_at timestamptz not null default now()
);

create index ai_messages_room_id_created_at_idx on ai_messages (room_id, created_at);

alter table ai_messages enable row level security;
create policy "public read" on ai_messages for select
  using (exists (select 1 from rooms r where r.id = room_id and r.status <> 'deleted'));

alter publication supabase_realtime add table ai_messages;
