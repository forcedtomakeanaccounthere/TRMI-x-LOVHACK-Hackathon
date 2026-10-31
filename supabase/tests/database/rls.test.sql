-- Row level security as the browser sees it: the frontend talks to Supabase with the anon key
-- (role "anon", or "authenticated" once logged in). The backend uses the service role, which
-- bypasses RLS, so rooms and recaps can only be written there.
-- Run with `npm run test:db`. Everything runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(126);

-- Fixtures, created as the table owner.
insert into rooms (id, kind, title) values ('room0001', 'link', 'Fixture room'), ('room0009', 'pdf', 'Other room');
insert into highlights (id, room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
values ('00000000-0000-0000-0000-000000000003', 'room0009', 'Ana', '#ff0000', 'p1', 0, 5, 'other');
insert into highlights (id, room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
values ('00000000-0000-0000-0000-000000000001', 'room0001', 'Ana', '#ff0000', 'b0', 0, 4, 'para');
insert into comments (id, room_id, highlight_id, author_name, author_color, body)
values ('00000000-0000-0000-0000-000000000002', 'room0001', '00000000-0000-0000-0000-000000000001', 'Ana', '#ff0000', 'Nice');
insert into recaps (room_id, data) values ('room0001', '{"summary": "fixture"}');
insert into storage.objects (bucket_id, name) values ('pdfs', 'room0001.pdf');
-- The Storage API sets this before deleting, which leaves the decision to RLS; without it, a trigger
-- refuses every direct delete and the delete checks below would pass for the wrong reason.
set local storage.allow_delete_query = 'true';

-- RLS is on for every table the browser can reach.
select ok(relrowsecurity, format('RLS is enabled on %s', relname))
from pg_class
where oid in (
  'public.rooms'::regclass,
  'public.highlights'::regclass,
  'public.comments'::regclass,
  'public.recaps'::regclass,
  'public.profiles'::regclass,
  'public.room_groups'::regclass,
  'public.room_group_items'::regclass,
  'public.room_participants'::regclass,
  'public.follows'::regclass,
  'public.room_invites'::regclass,
  'public.ai_queries'::regclass,
  'public.room_ai'::regclass,
  'public.chunks'::regclass,
  'public.ai_messages'::regclass
)
order by relname;

-- recaps.requested_by ("Recapped by …") follows the author-name rules (0009).
select lives_ok(
  $$insert into recaps (room_id, data, requested_by) values ('room0001', '{}', 'Priya')$$,
  'a recap can record who asked for it'
);
select throws_ok(
  $$insert into recaps (room_id, data, requested_by) values ('room0001', '{}', E' \n\t ')$$,
  '23514', null, 'a blank requested_by is refused'
);
select throws_ok(
  $$insert into recaps (room_id, data, requested_by) values ('room0001', '{}', repeat('x', 41))$$,
  '23514', null, 'a requested_by over 40 characters is refused'
);

insert into room_sources (room_id, data) values ('room0001', '{"kind": "transcript"}');

-- Guests (anon key, not logged in) -------------------------------------------------------------
set local role anon;
select is_empty($$select 1 from room_sources$$, 'anon cannot read a room''s raw transcript');

select isnt_empty($$select 1 from rooms where id = 'room0001'$$, 'anon can read rooms');
select isnt_empty($$select 1 from highlights where room_id = 'room0001'$$, 'anon can read highlights');
select isnt_empty($$select 1 from comments where room_id = 'room0001'$$, 'anon can read comments');
select isnt_empty($$select 1 from recaps where room_id = 'room0001'$$, 'anon can read recaps');

select lives_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', '#00ff00', 'b1', 2, 6, 'text')$$,
  'anon can add a highlight'
);
select lives_ok(
  $$insert into comments (room_id, highlight_id, author_name, author_color, body)
    values ('room0001', '00000000-0000-0000-0000-000000000001', 'Guest', '#00ff00', 'Agreed')$$,
  'anon can add a comment'
);

select throws_ok(
  $$insert into rooms (id, kind, title) values ('room0002', 'link', 'Sneaky')$$,
  '42501', null, 'anon cannot create rooms (only the backend can)'
);
select throws_ok(
  $$insert into recaps (room_id, data) values ('room0001', '{}')$$,
  '42501', null, 'anon cannot write recaps (only the backend can)'
);

-- No update or delete policies: the statements succeed but touch no rows.
select is_empty($$update rooms set title = 'Hijacked' where id = 'room0001' returning 1$$, 'anon cannot edit rooms');
select is_empty($$delete from rooms where id = 'room0001' returning 1$$, 'anon cannot delete rooms');
select is_empty(
  $$update highlights set quote = 'edited' where id = '00000000-0000-0000-0000-000000000001' returning 1$$,
  'anon cannot edit someone''s highlight'
);
select is_empty(
  $$delete from highlights where id = '00000000-0000-0000-0000-000000000001' returning 1$$,
  'anon cannot delete someone''s highlight'
);
select is_empty(
  $$update comments set body = 'edited' where id = '00000000-0000-0000-0000-000000000002' returning 1$$,
  'anon cannot edit someone''s comment'
);
select is_empty(
  $$delete from comments where id = '00000000-0000-0000-0000-000000000002' returning 1$$,
  'anon cannot delete someone''s comment'
);
select is_empty($$update recaps set data = '{}' where room_id = 'room0001' returning 1$$, 'anon cannot edit recaps');
select is_empty($$delete from recaps where room_id = 'room0001' returning 1$$, 'anon cannot delete recaps');

-- Storage: the pdfs bucket is readable by anyone, writable only by the backend.
select isnt_empty($$select 1 from storage.objects where bucket_id = 'pdfs' and name = 'room0001.pdf'$$, 'anon can read PDFs');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('pdfs', 'evil.pdf')$$,
  '42501', null, 'anon cannot upload PDFs'
);
select is_empty(
  $$update storage.objects set name = 'renamed.pdf' where bucket_id = 'pdfs' and name = 'room0001.pdf' returning 1$$,
  'anon cannot rename PDFs'
);
select is_empty(
  $$delete from storage.objects where bucket_id = 'pdfs' and name = 'room0001.pdf' returning 1$$,
  'anon cannot delete PDFs'
);

-- Input limits from 0002 hold for browser inserts too.
select throws_ok(
  $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#00ff00', '')$$,
  '23514', null, 'an empty comment is rejected'
);
select throws_ok(
  format(
    $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#00ff00', %L)$$,
    repeat('x', 2001)
  ),
  '23514', null, 'a comment over 2000 characters is rejected'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', '#00ff00', 'b1', 5, 2, 'text')$$,
  '23514', null, 'a highlight ending before it starts is rejected'
);

-- Shape checks from 0004: browser inserts skip zod, so the database checks what gets rendered.
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', 'red; background: url(//evil.example)', 'b1', 0, 4, 'text')$$,
  '23514', null, 'a highlight colour that is not #rrggbb is rejected'
);
select throws_ok(
  $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#0f0', 'Hi')$$,
  '23514', null, 'a short #rgb comment colour is rejected'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', '#00ff00', 'x1', 0, 4, 'text')$$,
  '23514', null, 'a block id that is not b{n}, p{n} or t{n} is rejected'
);
select lives_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0009', 'Guest', '#00ff00', 'p12', 0, 4, 'page')$$,
  'a highlight on a PDF page block is accepted'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', E' \t ', '#00ff00', 'b1', 0, 4, 'text')$$,
  '23514', null, 'an author name of only whitespace is rejected'
);
select throws_ok(
  $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#00ff00', E' \n ')$$,
  '23514', null, 'a comment of only whitespace is rejected'
);
select throws_ok(
  $$insert into highlights (author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('Guest', '#00ff00', 'b1', 0, 4, 'text')$$,
  '42501', null, 'a highlight without a room is rejected'
);
select col_not_null('public', 'highlights', 'room_id', 'highlights always belong to a room');
select throws_ok(
  $$insert into comments (room_id, highlight_id, author_name, author_color, body)
    values ('room0001', '00000000-0000-0000-0000-000000000003', 'Guest', '#00ff00', 'Wrong room')$$,
  '23503', null, 'a comment on a highlight from another room is rejected'
);
select throws_ok(
  $$insert into comments (room_id, highlight_id, author_name, author_color, body)
    values ('room0001', '00000000-0000-0000-0000-0000000000ff', 'Guest', '#00ff00', 'Ghost')$$,
  '23503', null, 'a comment on a highlight that does not exist is rejected'
);

-- Logged-in users (authenticated role): same access as guests, no extra writes ---------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated"}';

select lives_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Member', '#0000ff', 'b2', 0, 3, 'abc')$$,
  'logged-in users can add a highlight'
);
select lives_ok(
  $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Member', '#0000ff', 'Hi')$$,
  'logged-in users can add a comment'
);

select throws_ok(
  $$insert into rooms (id, kind, title) values ('room0003', 'link', 'Direct')$$,
  '42501', null, 'logged-in users cannot create rooms directly (they go through the backend)'
);
select is_empty($$update rooms set title = 'Hijacked' where id = 'room0001' returning 1$$, 'logged-in users cannot edit rooms');
select is_empty($$delete from rooms where id = 'room0001' returning 1$$, 'logged-in users cannot delete rooms');

select throws_ok(
  $$insert into recaps (room_id, data) values ('room0001', '{}')$$,
  '42501', null, 'logged-in users cannot write recaps'
);
select is_empty($$update recaps set data = '{}' where room_id = 'room0001' returning 1$$, 'logged-in users cannot edit recaps');

select is_empty(
  $$update highlights set quote = 'edited' where id = '00000000-0000-0000-0000-000000000001' returning 1$$,
  'logged-in users cannot edit someone''s highlight'
);
select is_empty(
  $$delete from highlights where id = '00000000-0000-0000-0000-000000000001' returning 1$$,
  'logged-in users cannot delete someone''s highlight'
);
select is_empty(
  $$update comments set body = 'edited' where id = '00000000-0000-0000-0000-000000000002' returning 1$$,
  'logged-in users cannot edit someone''s comment'
);
select is_empty(
  $$delete from comments where id = '00000000-0000-0000-0000-000000000002' returning 1$$,
  'logged-in users cannot delete someone''s comment'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('pdfs', 'member.pdf')$$,
  '42501', null, 'logged-in users cannot upload PDFs directly (they go through the backend)'
);
select is_empty(
  $$delete from storage.objects where bucket_id = 'pdfs' and name = 'room0001.pdf' returning 1$$,
  'logged-in users cannot delete PDFs'
);

-- Deleting a highlight still removes its thread through the composite foreign key ------------
reset role;
insert into comments (room_id, highlight_id, author_name, author_color, body)
values ('room0009', '00000000-0000-0000-0000-000000000003', 'Ana', '#ff0000', 'Thread');
select isnt_empty(
  $$select 1 from comments where highlight_id = '00000000-0000-0000-0000-000000000003'$$,
  'a comment on a highlight in the same room is accepted'
);
delete from highlights where id = '00000000-0000-0000-0000-000000000003';
select is_empty(
  $$select 1 from comments where highlight_id = '00000000-0000-0000-0000-000000000003'$$,
  'deleting a highlight deletes its comments'
);

-- Room status ------------------------------------------------------------------------------------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000bb');
insert into rooms (id, kind, title, status) values
  ('closed01', 'link', 'Closed', 'closed'),
  ('paused01', 'link', 'Paused', 'paused'),
  ('archive1', 'link', 'Archived', 'archived'),
  ('deleted1', 'link', 'Deleted', 'deleted');
insert into highlights (id, room_id, author_name, author_color, block_id, start_offset, end_offset, quote) values
  ('00000000-0000-0000-0000-000000000011', 'closed01', 'Ana', '#ff0000', 'b0', 0, 4, 'para'),
  ('00000000-0000-0000-0000-000000000012', 'deleted1', 'Ana', '#ff0000', 'b0', 0, 4, 'para');
insert into comments (room_id, highlight_id, author_name, author_color, body)
values ('deleted1', '00000000-0000-0000-0000-000000000012', 'Ana', '#ff0000', 'Nice');
insert into recaps (room_id, data) values ('deleted1', '{"summary": "fixture"}');
insert into room_participants (room_id, user_id) values ('room0001', '00000000-0000-0000-0000-0000000000aa');
insert into room_groups (id, owner_id, name)
values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000aa', 'Fixture group');
insert into room_group_items (room_id, group_id)
values ('room0001', '00000000-0000-0000-0000-0000000000cc');
insert into follows (follower_id, followee_id)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb');
insert into room_invites (room_id, inviter_id, invitee_id)
values ('room0001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb');
insert into ai_queries (room_id, user_id, kind, prompt)
values ('room0001', '00000000-0000-0000-0000-0000000000aa', 'recap', 'summarise');
set local role anon;

-- Every dashboard table is reached through apps/backend only.
select is_empty($$select 1 from profiles$$, 'profiles are private');
select is_empty($$select 1 from room_groups$$, 'groups are private');
select is_empty($$select 1 from room_group_items$$, 'which project a room is in is private');
select hasnt_column('public', 'rooms', 'group_id', 'the public rooms table says nothing about projects');
select is_empty($$select 1 from follows$$, 'follows are private');
select is_empty($$select 1 from room_invites$$, 'invites are private');
select is_empty($$select 1 from ai_queries$$, 'AI history is private');

select isnt_empty($$select 1 from rooms where id = 'closed01'$$, 'closed rooms stay readable');
select isnt_empty($$select 1 from rooms where id = 'paused01'$$, 'paused rooms stay readable');
select is_empty($$select 1 from rooms where id = 'deleted1'$$, 'deleted rooms are hidden');
select is_empty($$select 1 from highlights where room_id = 'deleted1'$$, 'highlights of deleted rooms are hidden');
select is_empty($$select 1 from comments where room_id = 'deleted1'$$, 'comments of deleted rooms are hidden');
select is_empty($$select 1 from recaps where room_id = 'deleted1'$$, 'recaps of deleted rooms are hidden');
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('closed01', 'Guest', '#00ff00', 'b1', 2, 6, 'text')$$,
  '42501', null, 'closed rooms take no new highlights'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('paused01', 'Guest', '#00ff00', 'b1', 2, 6, 'text')$$,
  '42501', null, 'paused rooms take no new highlights'
);
select throws_ok(
  $$insert into comments (room_id, highlight_id, author_name, author_color, body)
    values ('closed01', '00000000-0000-0000-0000-000000000011', 'Guest', '#00ff00', 'Late')$$,
  '42501', null, 'closed rooms take no new comments'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('archive1', 'Guest', '#00ff00', 'b1', 2, 6, 'text')$$,
  '42501', null, 'archived rooms take no new highlights'
);
select is_empty($$select 1 from room_participants$$, 'participation history is private');
select is_empty($$update rooms set status = 'deleted' where id = 'room0001' returning 1$$, 'anon cannot change a room''s status');

-- AI foundation (0010): new room kinds, source_meta, t{n} blocks, room_ai and the files bucket ----
reset role;
insert into rooms (id, kind, title, source_meta)
values ('file0001', 'file', 'notes.docx', '{"format": "docx", "file_name": "notes.docx"}');
-- Every room got a 'pending' room_ai row when it was created (0011's trigger).
select is(
  (select status from room_ai where room_id = 'file0001'), 'pending',
  'a new room is queued for indexing'
);
update room_ai set status = 'ready' where room_id = 'room0001';
insert into storage.objects (bucket_id, name) values ('files', 'file0001.docx');

select lives_ok($$insert into rooms (id, kind, title) values ('video001', 'youtube', 'A video')$$, 'a youtube room is accepted');
select throws_ok(
  $$insert into rooms (id, kind, title) values ('bad00001', 'video', 'Nope')$$,
  '23514', null, 'an unknown room kind is rejected'
);
select throws_ok(
  $$insert into rooms (id, kind, title, source_meta) values ('bad00002', 'file', 'Nope', '"docx"')$$,
  '23514', null, 'source_meta must be an object'
);
select throws_ok(
  $$update room_ai set status = 'done' where room_id = 'file0001'$$,
  '23514', null, 'an unknown AI status is rejected'
);
select throws_ok(
  $$insert into room_ai (room_id) values ('file0001')$$,
  '23505', null, 'a room has one AI state'
);
select lives_ok(
  $$insert into rooms (id, kind, title) values ('queued01', 'link', 'Queued'), ('queued02', 'link', 'Queued')$$,
  'creating several rooms at once queues each of them'
);
select is((select public from storage.buckets where id = 'files'), false, 'the files bucket is private');
select isnt_empty(
  $$select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'room_ai'$$,
  'room_ai changes are sent over Realtime'
);

set local role anon;
select isnt_empty($$select 1 from room_ai where room_id = 'room0001'$$, 'anon can read a room''s AI state');
select is_empty($$select 1 from room_ai where room_id = 'deleted1'$$, 'the AI state of a deleted room is hidden');
select throws_ok(
  $$insert into room_ai (room_id) values ('file0001')$$,
  '42501', null, 'anon cannot write AI state (only the backend can)'
);
select is_empty(
  $$update room_ai set summary = '{}' where room_id = 'room0001' returning 1$$,
  'anon cannot edit AI state'
);
select is_empty($$select 1 from storage.objects where bucket_id = 'files'$$, 'anon cannot read uploaded files');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('files', 'evil.docx')$$,
  '42501', null, 'anon cannot upload files'
);
select lives_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('file0001', 'Guest', '#00ff00', 't3', 0, 4, 'clip')$$,
  'a highlight on a transcript block t{n} is accepted'
);

-- Chunks and search (0011) -------------------------------------------------------------------------
reset role;
-- A 1024-number vector with a single 1 at position k: vectors with the same k are nearest.
create function pg_temp.onehot(k int) returns extensions.vector language sql as $fn$
  select ('[' || array_to_string(array(select (i = k)::int from generate_series(1, 1024) i), ',') || ']')::extensions.vector
$fn$;
insert into chunks (room_id, idx, content, block_ids, embedding, embedding_model) values
  ('room0001', 0, 'Transformers use attention to weigh words.', '{b0}', pg_temp.onehot(1), 'm'),
  ('room0001', 1, 'Cats sleep most of the day in warm places.', '{b1,b2}', pg_temp.onehot(2), 'm'),
  ('room0001', 2, 'Recurrent networks read one word at a time.', '{b3}', null, null),
  ('room0009', 0, 'Cats from another room.', '{p1}', pg_temp.onehot(2), 'm');

select is(
  array(select idx from match_chunks('room0001', pg_temp.onehot(2), null, 1)), array[1],
  'match_chunks finds the nearest chunk by embedding'
);
select is(
  array(select idx from match_chunks('room0001', null, 'How do cats sleep?', 8)), array[1],
  'match_chunks finds chunks by keyword, only in the room asked for'
);
select is(
  array(select idx from match_chunks('room0001', pg_temp.onehot(1), 'recurrent', 8)), array[0, 2, 1],
  'with both, a chunk found either way comes back, chunks without a vector included'
);
select is(
  array(select idx from match_chunks('room0001', null, 'what is the', 8)), '{}'::int[],
  'a question of only stop words matches nothing, without an error'
);
select throws_ok(
  $$insert into chunks (room_id, idx, content, block_ids) values ('room0001', 9, '', '{b9}')$$,
  '23514', null, 'an empty chunk is rejected'
);
select throws_ok(
  $$insert into chunks (room_id, idx, content, block_ids, embedding) values ('room0001', 9, 'x', '{b9}', '[1,2,3]')$$,
  '22000', null, 'an embedding of the wrong size is rejected'
);

set local role anon;
select is_empty($$select 1 from chunks$$, 'anon cannot read chunks');
select throws_ok(
  $$select * from match_chunks('room0001', null, 'cats', 8)$$,
  '42501', null, 'anon cannot search chunks (only the backend can)'
);
select throws_ok(
  $$insert into chunks (room_id, idx, content, block_ids) values ('room0001', 9, 'x', '{b9}')$$,
  '42501', null, 'anon cannot write chunks'
);

-- Ask the room (0012) -----------------------------------------------------------------------------
reset role;
insert into ai_messages (room_id, asked_by, question, answer, found_in_document, citations) values
  ('room0001', 'Ana', 'Why?', 'Because.', true, '[{"quote": "para", "block_ids": ["b0"], "page": null}]'),
  ('deleted1', null, 'Hidden?', 'Yes.', true, '[]');

select throws_ok(
  $$insert into ai_messages (room_id, question, answer, found_in_document, citations)
    values ('room0001', 'Why?', 'Because.', true, '{"quote": "x"}')$$,
  '23514', null, 'citations must be a list'
);
select throws_ok(
  $$insert into ai_messages (room_id, question, answer, found_in_document) values ('room0001', '', 'A', false)$$,
  '23514', null, 'an empty question is rejected'
);
select throws_ok(
  $$insert into ai_messages (room_id, kind, question, answer, found_in_document) values ('room0001', 'chat', 'Q', 'A', false)$$,
  '23514', null, 'an unknown message kind is rejected'
);
select isnt_empty(
  $$select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ai_messages'$$,
  'answers are sent over Realtime'
);

set local role anon;
select isnt_empty($$select 1 from ai_messages where room_id = 'room0001'$$, 'anon can read a room''s answers');
select is_empty($$select 1 from ai_messages where room_id = 'deleted1'$$, 'the answers of a deleted room are hidden');
select throws_ok(
  $$insert into ai_messages (room_id, question, answer, found_in_document) values ('room0001', 'Q', 'Fake answer', true)$$,
  '42501', null, 'anon cannot write answers (only the backend can)'
);
select is_empty($$update ai_messages set answer = 'Edited' where room_id = 'room0001' returning 1$$, 'anon cannot edit answers');

-- 0016: erasing a text mark removes its highlights row, only with the key whose hash the row keeps,
-- only by id and room, and only while the room is running.
reset role;
insert into rooms (id, kind, title, status) values ('rhopen01', 'link', 'Open', 'running'), ('rhclose1', 'link', 'Closed', 'closed');
insert into highlights (id, room_id, author_name, author_color, block_id, start_offset, end_offset, quote, remove_key_hash) values
  ('00000000-0000-4000-8000-0000000000e1', 'rhopen01', 'A', '#000000', 'b0', 0, 1, 'x', encode(sha256('key-e1-0123456789abcdef0123456789'::bytea), 'hex')),
  ('00000000-0000-4000-8000-0000000000e2', 'rhclose1', 'A', '#000000', 'b0', 0, 1, 'x', encode(sha256('key-e2-0123456789abcdef0123456789'::bytea), 'hex')),
  ('00000000-0000-4000-8000-0000000000e3', 'rhopen01', 'A', '#000000', 'b0', 0, 1, 'x', null);
set local role anon;
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e1', 'rhopen01', 'wrong-key-0123456789abcdef01234567'), false, 'a highlight is not removed without its key');
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e1', 'rhopen01', null), false, 'a highlight is not removed with no key');
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e3', 'rhopen01', 'key-e1-0123456789abcdef0123456789'), false, 'a highlight saved without a key cannot be removed');
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e2', 'rhopen01', 'key-e2-0123456789abcdef0123456789'), false, 'a highlight is only removed from its own room');
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e2', 'rhclose1', 'key-e2-0123456789abcdef0123456789'), false, 'a closed room''s highlights stay');
select is(public.remove_highlight('00000000-0000-4000-8000-0000000000e1', 'rhopen01', 'key-e1-0123456789abcdef0123456789'), true, 'the key holder removes a highlight in a running room');
select is_empty($$select 1 from highlights where id = '00000000-0000-4000-8000-0000000000e1'$$, 'the removed highlight is gone');
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote, remove_key_hash)
    values ('rhopen01', 'A', '#000000', 'b0', 0, 1, 'x', 'not-a-hash')$$,
  '23514', null, 'remove_key_hash must be a SHA-256 hex digest'
);

select * from finish();
rollback;
