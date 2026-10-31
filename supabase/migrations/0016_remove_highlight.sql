-- Erasing a text mark in the room workspace also removes its highlights row, so recaps and browsers
-- that load the room later agree with what the room sees.
--
-- Highlight ids are publicly readable, so an id is no proof of the right to remove one. When a browser
-- saves a highlight it also makes a random remove key: the highlight row gets only its SHA-256 hash
-- (remove_key_hash), and the key itself travels in the room's ledger to the people in the room, who
-- may erase the mark (its author, or a manager). remove_highlight deletes a row only for the key that
-- matches its hash, and only while the room is running, the same rule as inserting. Rows saved without
-- a key can't be removed this way. The highlight's comments go with it (on delete cascade).
alter table highlights add column remove_key_hash text
  constraint highlights_remove_key_hash_hex check (remove_key_hash ~ '^[0-9a-f]{64}$');

create or replace function public.remove_highlight(p_id uuid, p_room text, p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) < 32 then
    return false;
  end if;
  delete from highlights h
   where h.id = p_id
     and h.room_id = p_room
     and h.remove_key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
     and exists (select 1 from rooms r where r.id = p_room and r.status = 'running');
  return found;
end;
$$;

revoke execute on function public.remove_highlight(uuid, text, text) from public;
grant execute on function public.remove_highlight(uuid, text, text) to anon, authenticated, service_role;
