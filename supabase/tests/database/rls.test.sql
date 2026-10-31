-- Row level security as the browser sees it: the frontend talks to Supabase with the anon key
-- (role "anon", or "authenticated" once logged in). The backend uses the service role, which
-- bypasses RLS, so rooms and recaps can only be written there.
-- Run with `npm run test:db`. Everything runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(81);

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
  'public.ai_queries'::regclass
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

-- Guests (anon key, not logged in) -------------------------------------------------------------
set local role anon;

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
  '23514', null, 'a block id that is not b{n} or p{n} is rejected'
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

select * from finish();
rollback;
