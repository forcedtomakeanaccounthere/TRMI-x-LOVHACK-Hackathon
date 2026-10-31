from pydantic import BaseModel, Field

# RecapData must match packages/shared/src/schemas.ts. Input limits match the database checks
# (supabase/migrations 0002 and 0004), so anything apps/backend reads from the database fits.


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
    # Cut to max_document_chars before it reaches a model; this only bounds the request itself.
    text: str = Field(max_length=1_000_000)
    highlights: list[HighlightIn] = []
    comments: list[CommentIn] = []
