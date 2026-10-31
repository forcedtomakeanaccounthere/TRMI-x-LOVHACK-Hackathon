-- Erasing a text mark in the room workspace also removes its highlights row, so recaps and browsers
-- that load the room later agree with what the room sees. Browsers insert highlights with the anon key
-- (0004, 0005), so they remove them through this function: one row, by id and room, and only while
-- the room is running, the same rule as inserting. Its comments go with it (on delete cascade).
-- Returns whether a row was removed.
create or replace function public.remove_highlight(p_id uuid, p_room text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from highlights h
   where h.id = p_id
     and h.room_id = p_room
     and exists (select 1 from rooms r where r.id = p_room and r.status = 'running');
  return found;
end;
$$;

revoke execute on function public.remove_highlight(uuid, text) from public;
grant execute on function public.remove_highlight(uuid, text) to anon, authenticated, service_role;
