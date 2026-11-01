-- Studio artifacts (POST /api/rooms/:id/artifacts) are recorded in the AI history like recaps and
-- questions.
alter table ai_queries drop constraint ai_queries_kind_check;
alter table ai_queries add constraint ai_queries_kind_check check (kind in ('recap', 'ask', 'artifact'));
