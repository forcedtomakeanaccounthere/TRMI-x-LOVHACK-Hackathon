-- Auth: rooms remember which verified user created them (Supabase Auth, see apps/backend/src/routes/auth.ts).
alter table rooms add column created_by uuid references auth.users(id) on delete set null;
create index on rooms (created_by);

-- Input limits enforced by the database too, since highlights and comments are inserted from the browser.
alter table highlights
  add constraint highlights_quote_len check (char_length(quote) between 1 and 1000),
  add constraint highlights_author_name_len check (char_length(author_name) between 1 and 40),
  add constraint highlights_offsets check (start_offset >= 0 and end_offset >= start_offset);

alter table comments
  add constraint comments_body_len check (char_length(body) between 1 and 2000),
  add constraint comments_author_name_len check (char_length(author_name) between 1 and 40);

-- PDF bucket: 20 MB limit, PDFs only. Uploads go through apps/backend with the service role.
update storage.buckets
set file_size_limit = 20971520, allowed_mime_types = '{application/pdf}'
where id = 'pdfs';

create policy "public read pdfs" on storage.objects for select using (bucket_id = 'pdfs');
