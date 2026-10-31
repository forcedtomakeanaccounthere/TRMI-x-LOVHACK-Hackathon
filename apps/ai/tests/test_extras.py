import pytest

from app.schemas import CatchupData, ExplainData, QuizData, QuizQuestion
from app.services.extras import WITHHELD


class FakeAI:
    """Returns the answer set for the schema asked for, and records each prompt."""

    def __init__(self):
        self.answers = {}
        self.prompts: list[tuple[str, str]] = []

    async def __call__(self, provider, system, user, schema, timeout):
        self.prompts.append((system, user))
        return self.answers[schema]


@pytest.fixture
def ai(monkeypatch, clock):
    fake = FakeAI()
    monkeypatch.setattr("app.services.fallback.complete_json", fake)
    return fake


@pytest.fixture
def flagged(monkeypatch):
    texts: set[str] = set()

    async def fake(text):
        return ["hate_and_discrimination"] if text in texts else []

    monkeypatch.setattr("app.services.extras.flagged_categories", fake)
    return texts


HIGHLIGHTS = [{"author_name": "Priya", "block_id": "b1", "quote": "Attention is all you need"}]
COMMENTS = [
    {"author_name": "Arun", "highlight_id": "h1", "body": "Why attention? see https://a.test"}
]


def q(question="What?", options=("A", "B", "C", "D"), answer=1, sources=("b1",)):
    return QuizQuestion(
        question=question,
        options=list(options),
        answer_index=answer,
        explanation="Because.",
        source_blocks=list(sources),
    )


class TestCatchup:
    def test_summarizes_with_names_limited_to_people_in_the_room(self, client, auth, ai):
        ai.answers[CatchupData] = CatchupData(
            summary="<b>They</b> discussed attention, see https://evil.test",
            key_points=["Attention matters", ""],
            active_people=["priya", "Elon", "Arun"],
        )
        body = client.post(
            "/catchup",
            json={"title": "Paper", "highlights": HIGHLIGHTS, "comments": COMMENTS},
            headers=auth,
        ).json()
        assert body == {
            "summary": "They discussed attention, see [link removed]",
            "key_points": ["Attention matters"],
            "active_people": ["Priya", "Arun"],
        }
        assert "<comments>" in ai.prompts[0][1] and "untrusted" in ai.prompts[0][0]


class TestExplain:
    def test_explains_in_the_level_asked_for(self, client, auth, ai, flagged):
        ai.answers[ExplainData] = ExplainData(explanation="Matlab, model dhyan deta hai.")
        res = client.post(
            "/explain",
            json={"quote": "Attention", "context": ["Before.", "After."], "level": "hinglish"},
            headers=auth,
        )
        assert res.json() == {"explanation": "Matlab, model dhyan deta hai.", "withheld": False}
        system, user = ai.prompts[0]
        assert "Hinglish" in system
        assert "<highlight>\nAttention\n</highlight>" in user

    def test_a_flagged_explanation_is_withheld(self, client, auth, ai, flagged):
        ai.answers[ExplainData] = ExplainData(explanation="Hateful")
        flagged.add("Hateful")
        body = client.post("/explain", json={"quote": "x"}, headers=auth).json()
        assert body == {"explanation": WITHHELD, "withheld": True}

    def test_refuses_an_unknown_level(self, client, auth, ai):
        res = client.post("/explain", json={"quote": "x", "level": "poetic"}, headers=auth)
        assert res.status_code == 422


class TestQuiz:
    CHUNKS = [{"block_ids": ["b1", "b2"], "content": "Attention is all you need."}]

    def post(self, client, auth):
        return client.post("/quiz", json={"title": "Paper", "chunks": self.CHUNKS}, headers=auth)

    def test_keeps_only_usable_questions_with_known_sources(self, client, auth, ai):
        ai.answers[QuizData] = QuizData(
            questions=[
                q("Good?", sources=("b1", "b9")),
                q("Bad answer index", answer=7),
                q("Made-up source", sources=("b99",)),
                q("Empty option", options=("A", "", "C")),
                *[q(f"Extra {i}") for i in range(6)],
            ]
        )
        questions = self.post(client, auth).json()["questions"]
        assert len(questions) == 5
        assert questions[0] == {
            "question": "Good?",
            "options": ["A", "B", "C", "D"],
            "answer_index": 1,
            "explanation": "Because.",
            "source_blocks": ["b1"],
        }
        assert all("block" not in x["question"] for x in questions)

    def test_accepts_a_chunk_of_many_short_blocks(self, client, auth, ai):
        ai.answers[QuizData] = QuizData(questions=[q(sources=("b59",))])
        chunk = {"block_ids": [f"b{i}" for i in range(60)], "content": "Line. " * 60}
        res = client.post("/quiz", json={"title": "T", "chunks": [chunk]}, headers=auth)
        assert res.status_code == 200
        assert res.json()["questions"][0]["source_blocks"] == ["b59"]

    def test_a_quiz_with_no_usable_question_is_a_502(self, client, auth, ai):
        ai.answers[QuizData] = QuizData(questions=[q(sources=("b99",))])
        assert self.post(client, auth).status_code == 502


@pytest.mark.parametrize("path", ["/catchup", "/explain", "/quiz"])
def test_needs_the_internal_token(client, path):
    assert client.post(path, json={}).status_code == 401
