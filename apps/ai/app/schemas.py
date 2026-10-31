from pydantic import BaseModel

# RecapData must match packages/shared/src/schemas.ts.


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
    author_name: str
    block_id: str
    quote: str


class CommentIn(BaseModel):
    author_name: str
    highlight_id: str
    body: str


class RecapRequest(BaseModel):
    title: str
    text: str
    highlights: list[HighlightIn] = []
    comments: list[CommentIn] = []
