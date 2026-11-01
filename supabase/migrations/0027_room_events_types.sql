-- The room workspace gained events after 0020: dragging a comment or AI box (annot.move), reacting
-- to a message (chat.react) and the room's notes panel (notebook.*). room_events takes them now, so
-- the whole workspace can be kept on the server and a returning reader sees what changed.

alter table room_events drop constraint room_events_type_check;
alter table room_events add constraint room_events_type_check check (type in (
  'doc.add', 'doc.remove', 'annot.add', 'annot.remove', 'note.edit', 'annot.move', 'thread.ask',
  'thread.answer', 'chat', 'chat.react', 'notebook.add', 'notebook.edit', 'notebook.remove',
  'artifact.add', 'artifact.remove', 'role.set', 'member.kick', 'settings.update'
));

-- "Who added this room note": the author check for removals.
create index room_events_notebook_idx on room_events (room_id, type, (payload #>> '{entry,id}'))
  where type = 'notebook.add';
