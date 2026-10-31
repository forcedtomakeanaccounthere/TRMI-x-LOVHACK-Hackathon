from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field

# RecapData must match packages/shared/src/schemas.ts. Input limits match the database checks
# (supabase/migrations 0002 and 0004), so anything apps/backend reads from the database fits.


MAX_TEXT_CHARS = 1_000_000


class HealthResponse(BaseModel):
    ok: bool
    service: str
    providers: list[str]


class ErrorResponse(BaseModel):
    detail: str


class GroupFocus(BaseModel):
    quote: str
    who: list[str]
    why: str


class RecapData(BaseModel):
    one_line_summary: str
    key_points: list[str]
    what_the_group_cared_about: list[GroupFocus]
    disagreements: list[str]
    open_questions: list[str]
    next_steps: list[str]


class HighlightIn(BaseModel):
    author_name: str = Field(max_length=40)
    block_id: str = Field(max_length=16)
    quote: str = Field(max_length=1000)


class CommentIn(BaseModel):
    author_name: str = Field(max_length=40)
    # The database allows a comment without a highlight.
    highlight_id: str | None = Field(default=None, max_length=64)
    body: str = Field(max_length=2000)


class RecapRequest(BaseModel):
    title: str = Field(max_length=300)
    # Cut to max_document_chars before it reaches a model. Longer text is cut here, not refused:
    # an article the backend accepted must still get a recap.
    text: Annotated[str, BeforeValidator(lambda v: v[:MAX_TEXT_CHARS] if isinstance(v, str) else v)]
    highlights: list[HighlightIn] = []
    comments: list[CommentIn] = []


# POST /embed. apps/backend sends chunks in batches of 64; a chunk is at most 4,000 characters
# (supabase/migrations/0011_chunks.sql) and a question far less.
MAX_EMBED_TEXTS = 128
MAX_EMBED_CHARS = 8_000


class EmbedRequest(BaseModel):
    texts: list[Annotated[str, Field(min_length=1, max_length=MAX_EMBED_CHARS)]] = Field(
        min_length=1, max_length=MAX_EMBED_TEXTS
    )
    # "passage" for chunks being indexed, "query" for a question being searched.
    input_type: Literal["passage", "query"] = "passage"


class EmbedResponse(BaseModel):
    model: str
    vectors: list[list[float]]
