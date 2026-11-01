import base64
import binascii
import re
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

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


# POST /summary. RoomSummary must match packages/shared/src/schemas.ts. Chunks come from the
# chunks table (supabase/migrations/0011_chunks.sql), at most 400 per room.
MAX_SUMMARY_CHUNKS = 400


class SummaryChunk(BaseModel):
    block_ids: list[Annotated[str, Field(max_length=16)]] = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1, max_length=4000)
    heading_path: list[Annotated[str, Field(max_length=500)]] = Field(default=[], max_length=10)
    page: int | None = None


class SummaryRequest(BaseModel):
    title: str = Field(max_length=300)
    chunks: list[SummaryChunk] = Field(min_length=1, max_length=MAX_SUMMARY_CHUNKS)


class SourcedPoint(BaseModel):
    text: str
    # The block ids (b12, p3, t7) the point comes from.
    source_blocks: list[str]


class SummaryNotes(BaseModel):
    """What one map call writes about one group of chunks."""

    notes: list[SourcedPoint]


class SummarySection(BaseModel):
    heading: str
    points: list[SourcedPoint]


class KeyTerm(BaseModel):
    term: str
    meaning: str
    source_blocks: list[str]


class RoomSummary(BaseModel):
    overview: str
    sections: list[SummarySection]
    key_terms: list[KeyTerm]


# POST /answer. apps/backend sends the question and the best chunks from match_chunks (at most 8).
MAX_QUESTION_CHARS = 500
MAX_ANSWER_CHUNKS = 8


class AnswerChunk(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


# An AI box's passage, earlier turns of its conversation, and an AI-lens snapshot (a data URL).
MAX_QUOTE_CHARS = 1000
MAX_HISTORY_TURNS = 8
MAX_HISTORY_CHARS = 1000
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$")


class HistoryTurn(BaseModel):
    role: Literal["user", "ai"]
    text: str = Field(min_length=1, max_length=MAX_HISTORY_CHARS)


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    # Empty only when an image is sent: a snapshot question may have no matching text.
    chunks: list[AnswerChunk] = Field(default=[], max_length=MAX_ANSWER_CHUNKS)
    quote: str | None = Field(default=None, max_length=MAX_QUOTE_CHARS)
    history: list[HistoryTurn] = Field(default=[], max_length=MAX_HISTORY_TURNS)
    image: str | None = None

    @field_validator("image")
    @classmethod
    def _image_is_a_small_picture(cls, value: str | None) -> str | None:
        if value is None:
            return None
        match = IMAGE_DATA_URL.match(value)
        if not match:
            raise ValueError("image must be a JPEG, PNG or WebP data URL")
        try:
            data = base64.b64decode(match.group(2), validate=False)
        except (binascii.Error, ValueError) as e:
            raise ValueError("image is not valid base64") from e
        if not data:
            raise ValueError("image is empty")
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("image is larger than 5 MB")
        return value

    @model_validator(mode="after")
    def _something_to_answer_from(self) -> "AnswerRequest":
        if not self.chunks and not self.image:
            raise ValueError("send at least one chunk, or an image")
        return self


class Citation(BaseModel):
    # Which chunk, by its label: 1 for [C1].
    chunk: int
    # Copied exactly from that chunk.
    quote: str


class AnswerData(BaseModel):
    """The model's answer, and the checked answer apps/backend gets (shared AnswerResponse)."""

    answer: str
    found_in_document: bool
    citations: list[Citation]


class AnswerResult(AnswerData):
    """What POST /answer returns. Not in the model's schema, so the model can't set withheld."""

    withheld: bool = False  # moderation flagged the answer; apps/backend shows its own message


class ModerateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ModerateResponse(BaseModel):
    flagged: list[str]  # the blocking categories; empty when fine or moderation is unavailable


# --- YouTube transcripts (POST /transcript) ---

# Enough for a long lecture; a transcript with more segments is cut here.
MAX_TRANSCRIPT_SEGMENTS = 20_000


class TranscriptRequest(BaseModel):
    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    # Tried in order; any other language the video has is the fallback.
    languages: list[Annotated[str, Field(min_length=2, max_length=12)]] = Field(
        default=["en", "hi"], max_length=10
    )


class TranscriptSegment(BaseModel):
    start: float = Field(ge=0)
    duration: float = Field(ge=0)
    text: str


class TranscriptResponse(BaseModel):
    language: str
    is_generated: bool  # YouTube's automatic captions, usually without punctuation
    segments: list[TranscriptSegment]


# --- Step 9 extras: catch me up, explain a highlight, quiz ---

MAX_CATCHUP_ITEMS = 200
MAX_QUIZ_CHUNKS = 12


class CatchupRequest(BaseModel):
    title: str = Field(max_length=300)
    highlights: list[HighlightIn] = Field(default=[], max_length=MAX_CATCHUP_ITEMS)
    comments: list[CommentIn] = Field(default=[], max_length=MAX_CATCHUP_ITEMS)


class CatchupData(BaseModel):
    summary: str  # two or three sentences on what the group did
    key_points: list[str]
    active_people: list[str]  # who highlighted or commented, spelled as they wrote it


class ExplainRequest(BaseModel):
    quote: str = Field(min_length=1, max_length=1000)  # the highlighted text
    context: list[Annotated[str, Field(max_length=4000)]] = Field(default=[], max_length=5)
    level: Literal["simple", "hinglish"] = "simple"


class ExplainData(BaseModel):
    explanation: str


class ExplainResult(ExplainData):
    withheld: bool = False  # moderation flagged it; not in the model's schema


class QuizChunk(BaseModel):
    # A chunk of many short blocks (60 one-line paragraphs) lists every one, so this only bounds
    # the request: chunks are at most 2,000 characters, so they can't cover more blocks than that.
    block_ids: list[str] = Field(min_length=1, max_length=2000)
    content: str = Field(min_length=1, max_length=4000)


class QuizRequest(BaseModel):
    title: str = Field(max_length=300)
    chunks: list[QuizChunk] = Field(min_length=1, max_length=MAX_QUIZ_CHUNKS)


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    answer_index: int
    explanation: str
    source_blocks: list[str]


class QuizData(BaseModel):
    questions: list[QuizQuestion]


# --- Study tools: quiz, flashcards, mind map and infographic from one or more documents ---
# Shapes must match packages/shared/src/schemas.ts (Study*).

MAX_STUDY_DOCUMENTS = 20


class StudyDocument(BaseModel):
    # The room id, so every generated item can say which document it came from.
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(max_length=300)
    text: Annotated[str, BeforeValidator(lambda v: v[:MAX_TEXT_CHARS] if isinstance(v, str) else v)]


class StudyRequest(BaseModel):
    kind: Literal["quiz", "flashcards", "mindmap", "infographic"]
    documents: list[StudyDocument] = Field(min_length=1, max_length=MAX_STUDY_DOCUMENTS)
    # How many questions or cards; ignored by mind maps and infographics.
    count: int = Field(default=10, ge=3, le=30)
    # Optional topic to focus on, e.g. "chapter 3" or "definitions".
    focus: str | None = Field(default=None, max_length=200)


class StudyQuizQuestion(BaseModel):
    question: str
    options: list[str]
    answer_index: int
    explanation: str
    source_id: str | None = None


class StudyQuizData(BaseModel):
    kind: Literal["quiz"] = "quiz"
    title: str
    questions: list[StudyQuizQuestion]


class StudyFlashcard(BaseModel):
    front: str
    back: str
    source_id: str | None = None


class StudyFlashcardsData(BaseModel):
    kind: Literal["flashcards"] = "flashcards"
    title: str
    cards: list[StudyFlashcard]


class StudyMindMapNode(BaseModel):
    # Flat list with parent links: recursive JSON schemas trip up several providers.
    id: str
    label: str
    parent_id: str | None = None
    source_id: str | None = None


class StudyMindMapData(BaseModel):
    kind: Literal["mindmap"] = "mindmap"
    title: str
    nodes: list[StudyMindMapNode]


class StudyInfographicStat(BaseModel):
    label: str
    value: str
    source_id: str | None = None


class StudyInfographicSection(BaseModel):
    heading: str
    points: list[str]
    source_id: str | None = None


class StudyInfographicData(BaseModel):
    kind: Literal["infographic"] = "infographic"
    title: str
    subtitle: str
    stats: list[StudyInfographicStat]
    sections: list[StudyInfographicSection]
    key_takeaway: str


StudyData = Annotated[
    StudyQuizData | StudyFlashcardsData | StudyMindMapData | StudyInfographicData,
    Field(discriminator="kind"),
]
