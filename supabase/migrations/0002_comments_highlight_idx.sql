-- Comment threads are loaded per highlight; also covers the comments_highlight_id_fkey cascade.
create index on comments (highlight_id);
