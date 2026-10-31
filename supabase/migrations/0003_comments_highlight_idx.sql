-- Comment threads load per highlight; also covers the comments_highlight_id_fkey cascade.
-- Flagged by the Supabase performance advisor (unindexed foreign key).
create index if not exists comments_highlight_id_idx on comments (highlight_id);
