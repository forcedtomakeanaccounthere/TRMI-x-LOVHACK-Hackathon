-- Notifications for @mentions (feature 6): one row per mentioned person, plus the browser
-- subscriptions web-push needs. Reader liveness is already tracked in room_participants.last_seen_at
-- (rooms heartbeat route), so "offline" there means "email and push instead of a toast" with no new
-- presence table.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- null for notifications about a room that no longer exists; its title lives in the payload.
  room_id text references public.rooms (id) on delete set null,
  kind text not null default 'mention' check (kind in ('mention')),
  body text not null check (char_length(body) between 1 and 500),
  -- What the bell needs to render it: room_title, actor_name, kind (chat/note) from the source.
  payload jsonb not null default '{}'::jsonb,
  -- event_id:mentioned-user, so retrying or a duplicate announcement can't double-notify.
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox on public.notifications (user_id, created_at desc);
create index notifications_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
-- The backend writes and marks read with the service role (POST /api/notifications/read); a browser
-- may only read its own inbox directly.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  keys jsonb not null check (keys ? 'p256dh' and keys ? 'auth'),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
