-- Phase 3: highlights and comments are inserted straight from the browser with the anon key, so the
-- zod schemas in packages/shared never run on them. These checks make the database enforce the same
-- shapes, since anything stored here is rendered in every other reader's browser.

-- Every highlight and comment belongs to a room; an orphan row could never be shown or cleaned up.
delete from comments where room_id is null;
delete from highlights where room_id is null;
alter table highlights alter column room_id set not null;
alter table comments alter column room_id set not null;

-- Colours are applied as inline styles (cursor, avatar, highlight tint), so only #rrggbb is allowed:
-- no named colours, url(), var() or anything else CSS would interpret. Matches Author in packages/shared.
alter table highlights
  add constraint highlights_author_color_hex check (author_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Block anchors: "b{n}" for a link room's blocks, "p{n}" for a PDF page.
  add constraint highlights_block_id_format check (block_id ~ '^[bp][0-9]{1,6}$'),
  add constraint highlights_author_name_blank check (btrim(author_name) <> '');

alter table comments
  add constraint comments_author_color_hex check (author_color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint comments_author_name_blank check (btrim(author_name) <> ''),
  add constraint comments_body_blank check (btrim(body) <> '');

-- A comment's highlight must be in the same room as the comment, or a thread could show up in a room
-- it was never written in. The composite key lets the foreign key check both columns at once; a
-- comment without a highlight (highlight_id null) is not checked, as with any MATCH SIMPLE key.
alter table highlights add constraint highlights_id_room_id_key unique (id, room_id);
alter table comments drop constraint comments_highlight_id_fkey;
alter table comments
  add constraint comments_highlight_same_room_fkey
  foreign key (highlight_id, room_id) references highlights (id, room_id) on delete cascade;
