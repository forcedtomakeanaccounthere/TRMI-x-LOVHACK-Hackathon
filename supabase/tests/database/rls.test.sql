-- Row level security as the browser sees it: the frontend talks to Supabase with the anon key
-- (role "anon", or "authenticated" once logged in). The backend uses the service role, which
-- bypasses RLS, so rooms and recaps can only be written there.
-- Run with `npm run test:db`. Everything runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- Fixtures, created as the table owner.
insert into rooms (id, kind, title) values ('room0001', 'link', 'Fixture room');
insert into highlights (id, room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
values ('00000000-0000-0000-0000-000000000001', 'room0001', 'Ana', '#f00', 'b0', 0, 4, 'para');
insert into comments (id, room_id, highlight_id, author_name, author_color, body)
values ('00000000-0000-0000-0000-000000000002', 'room0001', '00000000-0000-0000-0000-000000000001', 'Ana', '#f00', 'Nice');
insert into recaps (room_id, data) values ('room0001', '{"summary": "fixture"}');

-- RLS is on for every table the browser can reach.
select ok(relrowsecurity, format('RLS is enabled on %s', relname))
from pg_class
where oid in ('public.rooms'::regclass, 'public.highlights'::regclass, 'public.comments'::regclass, 'public.recaps'::regclass)
order by relname;

-- Guests (anon key, not logged in) -------------------------------------------------------------
set local role anon;

select isnt_empty($$select 1 from rooms where id = 'room0001'$$, 'anon can read rooms');
select isnt_empty($$select 1 from highlights where room_id = 'room0001'$$, 'anon can read highlights');
select isnt_empty($$select 1 from comments where room_id = 'room0001'$$, 'anon can read comments');
select isnt_empty($$select 1 from recaps where room_id = 'room0001'$$, 'anon can read recaps');

select lives_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', '#0f0', 'b1', 2, 6, 'text')$$,
  'anon can add a highlight'
);
select lives_ok(
  $$insert into comments (room_id, highlight_id, author_name, author_color, body)
    values ('room0001', '00000000-0000-0000-0000-000000000001', 'Guest', '#0f0', 'Agreed')$$,
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
select is_empty($$delete from recaps where room_id = 'room0001' returning 1$$, 'anon cannot delete recaps');

-- Input limits from 0002 hold for browser inserts too.
select throws_ok(
  $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#0f0', '')$$,
  '23514', null, 'an empty comment is rejected'
);
select throws_ok(
  format(
    $$insert into comments (room_id, author_name, author_color, body) values ('room0001', 'Guest', '#0f0', %L)$$,
    repeat('x', 2001)
  ),
  '23514', null, 'a comment over 2000 characters is rejected'
);
select throws_ok(
  $$insert into highlights (room_id, author_name, author_color, block_id, start_offset, end_offset, quote)
    values ('room0001', 'Guest', '#0f0', 'b1', 5, 2, 'text')$$,
  '23514', null, 'a highlight ending before it starts is rejected'
);

-- Logged-in users (authenticated role) get no extra write access -----------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated"}';

select throws_ok(
  $$insert into rooms (id, kind, title) values ('room0003', 'link', 'Direct')$$,
  '42501', null, 'logged-in users cannot create rooms directly (they go through the backend)'
);
select is_empty(
  $$delete from comments where id = '00000000-0000-0000-0000-000000000002' returning 1$$,
  'logged-in users cannot delete someone''s comment'
);

-- Storage: the pdfs bucket is readable by anyone, writable only by the backend ----------------
reset role;
insert into storage.objects (bucket_id, name) values ('pdfs', 'room0001.pdf');
set local role anon;

select isnt_empty($$select 1 from storage.objects where bucket_id = 'pdfs' and name = 'room0001.pdf'$$, 'anon can read PDFs');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('pdfs', 'evil.pdf')$$,
  '42501', null, 'anon cannot upload PDFs'
);

select * from finish();
rollback;
