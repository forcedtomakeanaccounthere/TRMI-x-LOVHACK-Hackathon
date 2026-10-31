-- Room lifecycle: archived_at column, last_presence_at column, status stamp update, and automated lifecycle sweeper.
--
-- Rules:
-- 1. Everyone left room: pause after 30 minutes (no participants or guests seen in >= 30m).
-- 2. People present, but no activity (keystrokes, mouse events): pause after 2 hours (last_activity_at >= 2h).
-- 3. After pause, wait 10 days for archiving, archive date starts from last inactive day.

alter table rooms add column if not exists archived_at timestamptz;
create index if not exists rooms_archived_at_idx on rooms (archived_at desc);

alter table rooms add column if not exists last_presence_at timestamptz default now();
create index if not exists rooms_last_presence_at_idx on rooms (last_presence_at desc);

-- Update stamp_room_status trigger function to manage archived_at and presence
create or replace function public.stamp_room_status() returns trigger
language plpgsql as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'running' then
      new.paused_at := null;
      new.closed_at := null;
      new.deleted_at := null;
      new.archived_at := null;
      new.last_activity_at := now();
      new.last_presence_at := now();
    when 'paused' then
      new.paused_at := coalesce(new.paused_at, now());
      new.closed_at := null;
      new.archived_at := null;
    when 'closed' then
      new.paused_at := null;
      new.closed_at := coalesce(new.closed_at, now());
      new.archived_at := null;
    when 'archived' then
      new.paused_at := null;
      new.archived_at := coalesce(new.archived_at, now());
    when 'deleted' then
      new.deleted_at := coalesce(old.deleted_at, now());
  end case;

  return new;
end;
$$;

-- Stored procedure to sweep and transition room lifecycles.
-- Returns the list of rooms transitioned and their status changes.
create or replace function public.sweep_room_lifecycle()
returns table (
  room_id text,
  old_status text,
  new_status text,
  transition_reason text
)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  latest_seen timestamptz;
  has_live_participant boolean;
begin
  -- 1. Check running rooms for auto-pause conditions
  for r in
    select id, created_at, last_activity_at, last_presence_at
    from rooms
    where status = 'running'
    for update
  loop
    select max(last_seen_at) into latest_seen
    from room_participants
    where room_participants.room_id = r.id;

    -- A participant is considered live if either a registered participant or a guest presence was seen within the last 5 minutes
    has_live_participant := (
      (latest_seen is not null and latest_seen >= now() - interval '5 minutes')
      or
      (r.last_presence_at is not null and r.last_presence_at >= now() - interval '5 minutes')
    );

    if not has_live_participant then
      -- Everyone left (or room had no recorded participants): pause if inactive for >= 30 minutes
      -- Evaluates the newest timestamp across registered participants, guest presence, and creation date
      if greatest(
           coalesce(latest_seen, '-infinity'::timestamptz),
           coalesce(r.last_presence_at, '-infinity'::timestamptz),
           r.created_at
         ) < now() - interval '30 minutes'
         and r.last_activity_at < now() - interval '30 minutes' then
        update rooms set status = 'paused' where id = r.id;
        room_id := r.id;
        old_status := 'running';
        new_status := 'paused';
        transition_reason := 'empty_30m';
        return next;
      end if;
    else
      -- People are present, but no keystrokes or mouse events for >= 2 hours
      if r.last_activity_at < now() - interval '2 hours' then
        update rooms set status = 'paused' where id = r.id;
        room_id := r.id;
        old_status := 'running';
        new_status := 'paused';
        transition_reason := 'idle_2h';
        return next;
      end if;
    end if;
  end loop;

  -- 2. Check paused rooms for 10-day auto-archive condition
  -- "After pause wait 10 days for archiving, archive date starts from last inactive day."
  for r in
    select id, last_activity_at, paused_at
    from rooms
    where status = 'paused'
    for update
  loop
    if r.last_activity_at <= now() - interval '10 days' then
      update rooms
      set status = 'archived',
          archived_at = r.last_activity_at + interval '10 days'
      where id = r.id;
      room_id := r.id;
      old_status := 'paused';
      new_status := 'archived';
      transition_reason := 'archived_10d_inactive';
      return next;
    end if;
  end loop;
end;
$$;

revoke execute on function public.sweep_room_lifecycle() from public, anon, authenticated;
grant execute on function public.sweep_room_lifecycle() to service_role;
