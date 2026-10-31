-- Who asked for a recap, shown as "Recapped by Arun". The name a guest typed or a signed-in user's
-- display name; null when the client sent none. Same rules as author names on highlights and comments.
alter table recaps
  add column requested_by text
  check (requested_by is null or (char_length(requested_by) between 1 and 40 and requested_by ~ '[^[:space:]]'));

-- The recap cooldown reads the newest recap of a room on every request.
create index recaps_room_id_created_at_idx on recaps (room_id, created_at desc);
