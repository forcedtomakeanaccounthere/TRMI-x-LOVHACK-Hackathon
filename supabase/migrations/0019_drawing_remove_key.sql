-- Drawings were deletable by anyone holding the public key ("public delete" using (true)), and
-- through the backend's DELETE route, which checked only that the room existed. Ids are publicly
-- readable, so an id is no proof of the right to remove a stroke.
--
-- Same rule as highlights (0016_remove_highlight.sql): the browser that saves a stroke makes a random
-- remove key and keeps it to itself; the row gets only the key's SHA-256 hash. remove_drawing deletes
-- a row only for the key that matches it. Strokes saved without a key can't be removed this way.
drop policy "public delete" on drawings;

alter table drawings add column remove_key_hash text
  constraint drawings_remove_key_hash_hex check (remove_key_hash ~ '^[0-9a-f]{64}$');

create or replace function public.remove_drawing(p_id uuid, p_room text, p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or length(p_key) < 32 then
    return false;
  end if;
  delete from drawings d
   where d.id = p_id
     and d.room_id = p_room
     and d.remove_key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  return found;
end;
$$;

revoke execute on function public.remove_drawing(uuid, text, text) from public;
grant execute on function public.remove_drawing(uuid, text, text) to anon, authenticated, service_role;
