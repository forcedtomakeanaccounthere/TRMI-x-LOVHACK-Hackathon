-- The workspace ledger tables (0020_room_ledger.sql): only the backend (service role) reads or writes
-- them, events are never edited, and deleting a room removes its ledger.
-- Run with `npm run test:db`. Everything runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into rooms (id, kind, title) values ('ledg0001', 'link', 'Ledger room');
insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
values ('ledg0001', 'e1', 'chat', 'guest-abcd1234', 'Gus', '{"type": "chat"}', now());
insert into room_members (room_id, member_id, name, role) values ('ledg0001', 'guest-abcd1234', 'Gus', 'viewer');
insert into room_settings (room_id) values ('ledg0001');

select ok(relrowsecurity, format('RLS is enabled on %s', relname))
from pg_class
where oid in ('public.room_events'::regclass, 'public.room_members'::regclass, 'public.room_settings'::regclass)
order by relname;

-- Defaults match the frontend's DEFAULT_SETTINGS.
select results_eq(
  $$select allow_guests, guest_role, member_role, viewers_use_ai from room_settings where room_id = 'ledg0001'$$,
  $$values (true, 'editor', 'editor', true)$$,
  'room settings default to the frontend''s'
);

-- Append-only, even for the table owner.
select throws_ok(
  $$update room_events set actor_name = 'Hacked' where room_id = 'ledg0001'$$,
  '42501', 'room_events is append-only', 'an event cannot be edited'
);
select throws_ok(
  $$insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
    values ('ledg0001', 'e1', 'chat', 'x', 'X', '{}', now())$$,
  '23505', null, 'an event id is used once per room'
);
select throws_ok(
  $$insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
    values ('ledg0001', 'e2', 'room.delete', 'x', 'X', '{}', now())$$,
  '23514', null, 'an unknown event type is refused'
);
select throws_ok(
  $$insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
    values ('ledg0001', 'e3', 'chat', 'x', 'X', '[]', now())$$,
  '23514', null, 'a payload must be an object'
);
select throws_ok(
  $$insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
    values ('ledg0001', 'bad id!', 'chat', 'x', 'X', '{}', now())$$,
  '23514', null, 'an event id must be url-safe'
);
select throws_ok(
  $$insert into room_members (room_id, member_id, name, role) values ('ledg0001', 'm2', 'M', 'owner')$$,
  '23514', null, 'nobody is stored as owner (the owner is rooms.created_by)'
);
select throws_ok(
  $$insert into room_members (room_id, member_id, name, key_hash) values ('ledg0001', 'm3', 'M', 'not-a-hash')$$,
  '23514', null, 'a guest key is stored only as a sha256 hex digest'
);
select throws_ok(
  $$insert into room_settings (room_id, guest_role) values ('ledg0001', 'admin')$$,
  '23514', null, 'guests can''t default to admin'
);

-- Browsers (anon and authenticated) can't reach any of it.
set local role anon;
select throws_ok($$select 1 from room_events$$, '42501', null, 'anon cannot read the ledger');
select throws_ok(
  $$insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
    values ('ledg0001', 'e9', 'chat', 'x', 'X', '{}', now())$$,
  '42501', null, 'anon cannot append events'
);
select throws_ok($$select 1 from room_members$$, '42501', null, 'anon cannot read members (or guest key hashes)');
select throws_ok($$update room_settings set allow_guests = false$$, '42501', null, 'anon cannot change settings');

set local role authenticated;
select throws_ok($$select 1 from room_events$$, '42501', null, 'a signed-in browser cannot read the ledger either');
select throws_ok(
  $$update room_members set role = 'admin' where member_id = 'guest-abcd1234'$$,
  '42501', null, 'a signed-in browser cannot hand out roles'
);
select throws_ok($$delete from room_events$$, '42501', null, 'a signed-in browser cannot delete events');

reset role;
-- Deleting a room takes its ledger with it.
delete from rooms where id = 'ledg0001';
select is_empty($$select 1 from room_events where room_id = 'ledg0001'$$, 'events go with the room');
select is_empty($$select 1 from room_members where room_id = 'ledg0001'$$, 'members go with the room');

select * from finish();
rollback;
