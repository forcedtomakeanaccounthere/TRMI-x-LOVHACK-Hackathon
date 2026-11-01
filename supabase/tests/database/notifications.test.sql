-- Row level security for @mention notifications and push subscriptions (migration 0024). The
-- backend writes both with the service role; a browser may read only its own rows, never write.
-- Run with `npm run test:db`. Everything runs in one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ana.notif@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'ben.notif@example.com');
insert into rooms (id, kind, title) values ('notif001', 'link', 'Notif room');
insert into notifications (id, user_id, room_id, body, dedupe_key) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'notif001', '@Ana hi', 'e1::a'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'notif001', '@Ben hi', 'e1::b');
insert into push_subscriptions (endpoint, user_id, keys) values
  ('https://push.example/ana', '00000000-0000-0000-0000-0000000000a1', '{"p256dh": "p", "auth": "a"}'),
  ('https://push.example/ben', '00000000-0000-0000-0000-0000000000b1', '{"p256dh": "p", "auth": "a"}');

select ok(relrowsecurity, format('RLS is enabled on %s', relname))
from pg_class where oid in ('public.notifications'::regclass, 'public.push_subscriptions'::regclass);

-- Constraints the fan-out relies on.
select throws_ok(
  $$insert into notifications (user_id, body, dedupe_key) values ('00000000-0000-0000-0000-0000000000a1', 'again', 'e1::a')$$,
  '23505', null, 'the same event notifies a person once (dedupe_key is unique)');
select throws_ok(
  $$insert into notifications (user_id, body) values ('00000000-0000-0000-0000-0000000000a1', '')$$,
  '23514', null, 'a notification has a body');
select throws_ok(
  $$insert into push_subscriptions (endpoint, user_id, keys) values ('https://push.example/x', '00000000-0000-0000-0000-0000000000a1', '{"auth": "a"}')$$,
  '23514', null, 'a push subscription needs both keys');

-- Anonymous browsers see nothing.
set local role anon;
select is((select count(*)::int from notifications), 0, 'anon reads no notifications');
select is((select count(*)::int from push_subscriptions), 0, 'anon reads no push subscriptions');
reset role;

-- Ana, signed in, sees only her own.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}', true);
select is((select array_agg(body) from notifications), array['@Ana hi'], 'Ana reads only her notification');
select is((select array_agg(endpoint) from push_subscriptions), array['https://push.example/ana'], 'Ana reads only her subscription');

-- She can't write: not notify anyone, not mark read, not subscribe a browser for someone.
select throws_ok(
  $$insert into notifications (user_id, body) values ('00000000-0000-0000-0000-0000000000b1', 'spam')$$,
  '42501', null, 'a browser cannot create notifications');
update notifications set read_at = now() where id = '00000000-0000-0000-0000-00000000aa01';
select throws_ok(
  $$insert into push_subscriptions (endpoint, user_id, keys) values ('https://push.example/evil', '00000000-0000-0000-0000-0000000000b1', '{"p256dh": "p", "auth": "a"}')$$,
  '42501', null, 'a browser cannot add push subscriptions');
delete from push_subscriptions where endpoint = 'https://push.example/ben';
delete from notifications where id = '00000000-0000-0000-0000-00000000bb01';
reset role;

select is((select read_at from notifications where id = '00000000-0000-0000-0000-00000000aa01'), null, 'marking read goes through the backend, not the browser');
select is((select count(*)::int from push_subscriptions where endpoint = 'https://push.example/ben'), 1, 'Ana cannot remove Ben''s subscription');
select is((select count(*)::int from notifications where id = '00000000-0000-0000-0000-00000000bb01'), 1, 'Ana cannot delete Ben''s notification');

select * from finish();
rollback;
