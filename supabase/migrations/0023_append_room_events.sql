-- Appends checked ledger events and the role, kick and settings changes they make in one transaction,
-- so an event can't be saved without its effect (a kick in History that never applied).
--
-- apps/backend checks each event against the room's state as it read it, then passes the ledger's
-- last seq it saw. Writes to one room are serialized by an advisory lock; if another write landed
-- after that read, nothing is written and 'conflict' comes back, and the backend reads and checks
-- again. Member and settings changes are patches applied to the current rows (only the role, only
-- the kick, only the settings named), never whole rows from an older snapshot.
--
-- p_events:   [{ id, type, actor_id, actor_name, payload, at }]
-- p_writer:   { member_id, name } or null: the writer's latest display name
-- p_members:  [{ member_id, name, role? , kick? }] in event order
-- p_settings: a partial RoomSettings ({ allowGuests?, guestRole?, memberRole?, viewersUseAi? }) or null
create function public.append_room_events(
  p_room text,
  p_expected_seq bigint,
  p_events jsonb,
  p_writer jsonb,
  p_members jsonb,
  p_settings jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
  m jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('room_events:' || p_room, 0));
  select coalesce(max(seq), 0) into v_seq from room_events where room_id = p_room;
  if v_seq <> p_expected_seq then
    return 'conflict';
  end if;

  insert into room_events (room_id, id, type, actor_id, actor_name, payload, at)
  select p_room, e->>'id', e->>'type', e->>'actor_id', e->>'actor_name', e->'payload', (e->>'at')::timestamptz
  from jsonb_array_elements(p_events) as e
  on conflict (room_id, id) do nothing;

  if p_writer is not null then
    insert into room_members (room_id, member_id, name)
    values (p_room, p_writer->>'member_id', p_writer->>'name')
    on conflict (room_id, member_id) do update set name = excluded.name;
  end if;

  for m in select value from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) loop
    insert into room_members (room_id, member_id, name, role, kicked_at)
    values (
      p_room,
      m->>'member_id',
      m->>'name',
      m->>'role',
      case when coalesce((m->>'kick')::boolean, false) then now() end
    )
    on conflict (room_id, member_id) do update set
      role = case when m ? 'role' then excluded.role else room_members.role end,
      kicked_at = case
        when coalesce((m->>'kick')::boolean, false) then coalesce(room_members.kicked_at, now())
        else room_members.kicked_at
      end;
  end loop;

  if p_settings is not null and p_settings <> '{}'::jsonb then
    insert into room_settings (room_id) values (p_room) on conflict (room_id) do nothing;
    update room_settings set
      allow_guests = coalesce((p_settings->>'allowGuests')::boolean, allow_guests),
      guest_role = coalesce(p_settings->>'guestRole', guest_role),
      member_role = coalesce(p_settings->>'memberRole', member_role),
      viewers_use_ai = coalesce((p_settings->>'viewersUseAi')::boolean, viewers_use_ai),
      updated_at = now()
    where room_id = p_room;
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.append_room_events(text, bigint, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.append_room_events(text, bigint, jsonb, jsonb, jsonb, jsonb) to service_role;
