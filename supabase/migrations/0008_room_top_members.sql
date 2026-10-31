-- The most active people in a room, counted in the database so a busy room isn't cut off by the
-- API's row limit. Highlights and comments only carry a typed author name, not an account, so
-- people are told apart by name: guests count, and "Ana" and "ana " are the same person.
create function public.room_top_members(target_room text, max_members int default 3)
returns table (name text, color text, highlight_count int, comment_count int)
language sql stable set search_path = public as $$
  with activity as (
    select author_name, author_color, created_at, 1 as highlights, 0 as comments
    from highlights where room_id = target_room
    union all
    select author_name, author_color, created_at, 0, 1
    from comments where room_id = target_room
  )
  select
    (array_agg(btrim(author_name) order by created_at desc))[1],
    (array_agg(author_color order by created_at desc))[1],
    sum(highlights)::int,
    sum(comments)::int
  from activity
  group by lower(btrim(author_name))
  -- Ties go to whoever was active most recently, then by name, so the order is stable.
  order by count(*) desc, max(created_at) desc, lower(btrim(author_name))
  limit max_members;
$$;

-- Served through the API, like the rest of the dashboard.
revoke execute on function public.room_top_members(text, int) from public, anon, authenticated;
grant execute on function public.room_top_members(text, int) to service_role;
