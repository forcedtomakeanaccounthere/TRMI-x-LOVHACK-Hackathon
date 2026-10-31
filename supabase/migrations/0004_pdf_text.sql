-- PDF rooms: plain text of the first pages, extracted by apps/backend on upload and sent to the
-- AI recap. Link rooms leave it null and the recap uses content_html instead.
alter table rooms add column content_text text;

alter table rooms
  add constraint rooms_content_text_len check (char_length(content_text) <= 60000);
