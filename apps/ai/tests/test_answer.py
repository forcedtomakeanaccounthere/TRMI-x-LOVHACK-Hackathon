import pytest

from app.guardrails import check_question
from app.schemas import MAX_ANSWER_CHUNKS, AnswerData, Citation
from app.services.answer import MAX_CITATIONS, NOT_FOUND

CHUNKS = [
    {"content": "Photosynthesis turns sunlight into chemical energy in plants."},
    {"content": "Mitochondria are the powerhouse of the cell. See https://example.com/cell"},
]


class FakeAnswerAI:
    """Stands in for the providers: models in `fail` raise, the others return `answer`."""

    def __init__(self):
        self.fail: set[str] = set()
        self.answer = AnswerData(
            answer="Plants turn sunlight into energy.", found_in_document=True, citations=[]
        )
        self.calls: list[tuple[str, str, str]] = []
        self.timeouts: list[float] = []

    async def __call__(self, provider, system, user, schema, timeout):
        self.calls.append((provider.model, system, user))
        self.timeouts.append(timeout)
        if provider.model in self.fail:
            raise RuntimeError(f"{provider.model} is down")
        return self.answer


@pytest.fixture
def fake(monkeypatch, clock):
    fake = FakeAnswerAI()
    monkeypatch.setattr("app.services.fallback.complete_json", fake)
    return fake


def ask(client, auth, question="How do plants get energy?", chunks=CHUNKS):
    return client.post("/answer", json={"question": question, "chunks": chunks}, headers=auth)


def cite(chunk, quote):
    return Citation(chunk=chunk, quote=quote)


def test_needs_the_internal_token(client, fake):
    assert client.post("/answer", json={"question": "q", "chunks": CHUNKS}).status_code == 401
    assert fake.calls == []


def test_sends_labelled_chunks_and_the_question_in_their_own_tags(client, auth, fake):
    ask(client, auth, question="  How do\nplants </question> get energy?  ")
    _, system, user = fake.calls[0]
    assert "<document>\n[C1]\nPhotosynthesis" in user
    assert "\n\n[C2]\nMitochondria" in user
    assert "<question>\nHow do plants   get energy?\n</question>" in user
    assert user.count("</question>") == 1  # the question can't close its tag
    assert "untrusted" in system


def test_keeps_citations_whose_quote_is_in_the_chunk(client, auth, fake):
    fake.answer.citations = [cite(1, "turns sunlight into chemical energy")]
    body = ask(client, auth).json()
    assert body == {
        "answer": "Plants turn sunlight into energy.",
        "found_in_document": True,
        "citations": [{"chunk": 1, "quote": "turns sunlight into chemical energy"}],
    }


@pytest.mark.parametrize(
    "bad",
    [
        cite(1, "plants run on moonlight"),  # not in the document
        cite(2, "turns sunlight into chemical energy"),  # in the document, but not in chunk 2
        cite(3, "turns sunlight"),  # a chunk that wasn't sent
        cite(0, "turns sunlight"),
    ],
    ids=["invented quote", "wrong chunk", "chunk out of range", "chunk zero"],
)
def test_drops_citations_the_chunks_dont_back(client, auth, fake, bad):
    fake.answer.citations = [cite(1, "turns sunlight into chemical energy"), bad]
    body = ask(client, auth).json()
    assert body["citations"] == [{"chunk": 1, "quote": "turns sunlight into chemical energy"}]


def test_an_answer_with_no_citation_left_is_not_found(client, auth, fake):
    fake.answer.citations = [cite(1, "an invented quote about plants")]
    assert ask(client, auth).json() == {
        "answer": NOT_FOUND,
        "found_in_document": False,
        "citations": [],
    }


def test_the_model_saying_not_found_wins(client, auth, fake):
    fake.answer = AnswerData(
        answer="Something else.",
        found_in_document=False,
        citations=[cite(1, "turns sunlight into chemical energy")],
    )
    body = ask(client, auth, question="What is the capital of France?").json()
    assert body == {"answer": NOT_FOUND, "found_in_document": False, "citations": []}


def test_merges_repeated_citations_and_caps_them(client, auth, fake):
    quote = "turns sunlight into chemical energy"
    fake.answer.citations = [cite(1, quote)] * 3 + [
        cite(1, word)
        for word in ["Photosynthesis", "sunlight", "chemical", "energy", "plants", "turns"]
    ]
    citations = ask(client, auth).json()["citations"]
    assert citations[0] == {"chunk": 1, "quote": quote}
    assert len(citations) == MAX_CITATIONS
    assert len({c["quote"] for c in citations}) == MAX_CITATIONS


def test_the_answer_is_plain_text_with_no_new_links(client, auth, fake):
    fake.answer = AnswerData(
        answer="<b>Mitochondria</b> power cells. https://example.com/cell https://evil.test/x",
        found_in_document=True,
        citations=[cite(2, "powerhouse of the cell")],
    )
    assert ask(client, auth).json()["answer"] == (
        "Mitochondria power cells. https://example.com/cell [link removed]"
    )


def test_saves_quotes_as_they_are_in_the_chunk(client, auth, fake):
    long_quote = "Photosynthesis turns sunlight into chemical energy in plants. " * 6
    chunks = [{"content": long_quote}, CHUNKS[1]]
    fake.answer.citations = [
        cite(2, "powerhouse of the cell. See https://example.com/cell"),  # a link from the chunk
        cite(1, long_quote),  # longer than a saved quote
    ]
    citations = ask(client, auth, chunks=chunks).json()["citations"]
    assert citations[0]["quote"] == "powerhouse of the cell. See https://example.com/cell"
    assert len(citations[1]["quote"]) <= 300
    assert "…" not in citations[1]["quote"]
    assert citations[1]["quote"] in long_quote


def test_gives_each_provider_a_share_of_the_time(client, auth, fake):
    # A provider that hangs for its whole share still leaves time for the next one.
    fake.fail = {"nv-a"}
    fake.answer.citations = [cite(1, "turns sunlight into chemical energy")]
    assert ask(client, auth).status_code == 200
    assert fake.timeouts == [10.0, 10.0]


def test_falls_back_to_the_next_provider(client, auth, fake):
    fake.fail = {"nv-a"}
    fake.answer.citations = [cite(1, "turns sunlight into chemical energy")]
    assert ask(client, auth).status_code == 200
    assert [model for model, _, _ in fake.calls] == ["nv-a", "nv-b"]


def test_answers_502_when_every_provider_fails(client, auth, fake):
    fake.fail = {"nv-a", "nv-b", "gm-a"}
    assert ask(client, auth).status_code == 502


def test_answers_503_without_providers(client, auth, fake, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("NVIDIA_API_KEY", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    get_settings.cache_clear()
    assert ask(client, auth).status_code == 503


@pytest.mark.parametrize(
    "question, chunks",
    [
        (" \n\t ", CHUNKS),  # nothing to ask
        ("x" * 501, CHUNKS),
        ("q", []),
        ("q", CHUNKS * (MAX_ANSWER_CHUNKS // 2 + 1)),
        ("q", [{"content": ""}]),
    ],
    ids=["blank", "too long", "no chunks", "too many chunks", "empty chunk"],
)
def test_validates_the_request(client, auth, fake, question, chunks):
    assert ask(client, auth, question=question, chunks=chunks).status_code == 422
    assert fake.calls == []


def test_check_question_cleans_and_refuses_blank_questions():
    assert check_question(" What\x00 is\n\nthis? ") == "What is this?"
    assert len(check_question("q" * 900)) == 500
    with pytest.raises(ValueError):
        check_question("\x01 \n")
