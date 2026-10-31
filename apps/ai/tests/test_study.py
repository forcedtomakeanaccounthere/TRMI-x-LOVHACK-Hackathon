import pytest

from app.schemas import (
    StudyDocument,
    StudyFlashcard,
    StudyFlashcardsData,
    StudyInfographicData,
    StudyInfographicSection,
    StudyInfographicStat,
    StudyMindMapData,
    StudyMindMapNode,
    StudyQuizData,
    StudyQuizQuestion,
    StudyRequest,
)
from app.services.study import share_budget

DOCS = [
    {"id": "room0001", "title": "Moon", "text": "Apollo 11 landed in 1969. It carried 3 crew."},
    {"id": "room0002", "title": "Mars", "text": "Mars has two moons, Phobos and Deimos."},
]


@pytest.fixture
def study_ai(fake_ai, monkeypatch):
    monkeypatch.setattr("app.services.study.complete_json", fake_ai)
    return fake_ai


def post(client, auth, kind, **extra):
    return client.post("/study", json={"kind": kind, "documents": DOCS, **extra}, headers=auth)


def q(question, options, answer, source="room0001"):
    return StudyQuizQuestion(
        question=question, options=options, answer_index=answer, explanation="e", source_id=source
    )


def test_quiz_is_cleaned_and_keeps_the_right_answer(client, auth, study_ai):
    study_ai.answer = StudyQuizData(
        title="Space <b>quiz</b>",
        questions=[
            # Duplicate option removed: the right answer moves from index 2 to 1.
            q("When did Apollo 11 land?", ["1965", "1965", "1969", "1972"], 2),
            q("Bad index", ["a", "b"], 5),
            q("Unknown source", ["Phobos", "Titan"], 0, source="room9999"),
            q("When did Apollo 11 land?", ["1969", "1970"], 0),  # duplicate question
        ],
    )
    res = post(client, auth, "quiz", count=5)
    assert res.status_code == 200
    body = res.json()
    assert body["kind"] == "quiz"
    assert body["title"] == "Space quiz"
    questions = [x["question"] for x in body["questions"]]
    assert questions == ["When did Apollo 11 land?", "Unknown source"]
    first = body["questions"][0]
    assert first["options"] == ["1965", "1969", "1972"]
    assert first["options"][first["answer_index"]] == "1969"
    assert body["questions"][1]["source_id"] is None


def test_prompt_wraps_every_document_with_its_id(client, auth, study_ai):
    study_ai.answer = StudyFlashcardsData(title="t", cards=[StudyFlashcard(front="f", back="b")])
    post(client, auth, "flashcards", focus="moons")
    assert study_ai.user.count("<document>") == 2
    assert "<focus>\nmoons\n</focus>" in study_ai.user
    assert "id: room0001" in study_ai.user and "id: room0002" in study_ai.user
    assert "untrusted" in study_ai.system
    assert "flashcards" in study_ai.system


def test_flashcards_are_capped_at_count(client, auth, study_ai):
    cards = [StudyFlashcard(front=f"f{i}", back="b", source_id="room0002") for i in range(10)]
    study_ai.answer = StudyFlashcardsData(title="t", cards=cards)
    res = post(client, auth, "flashcards", count=3)
    assert len(res.json()["cards"]) == 3


def test_mindmap_becomes_one_tree(client, auth, study_ai):
    study_ai.answer = StudyMindMapData(
        title="Space",
        nodes=[
            StudyMindMapNode(id="r", label="Space"),
            StudyMindMapNode(id="a", label="Moon", parent_id="r"),
            StudyMindMapNode(id="b", label="Orphan", parent_id="missing"),
            StudyMindMapNode(id="c", label="Loop 1", parent_id="d"),
            StudyMindMapNode(id="d", label="Loop 2", parent_id="c"),
            StudyMindMapNode(id="e", label="Second root"),
        ],
    )
    nodes = post(client, auth, "mindmap").json()["nodes"]
    by_id = {n["id"]: n for n in nodes}
    assert nodes[0]["id"] == "r" and nodes[0]["parent_id"] is None
    assert [n for n in nodes if n["parent_id"] is None] == [nodes[0]]
    for n in nodes[1:]:  # every node reaches the root
        seen, cur = set(), n
        while cur["parent_id"]:
            assert cur["id"] not in seen
            seen.add(cur["id"])
            cur = by_id[cur["parent_id"]]
        assert cur["id"] == "r"


def test_infographic_drops_stats_not_in_the_documents(client, auth, study_ai):
    study_ai.answer = StudyInfographicData(
        title="Space",
        subtitle="s",
        stats=[
            StudyInfographicStat(label="Landing", value="1969", source_id="room0001"),
            StudyInfographicStat(label="Made up", value="42%", source_id="room0001"),
        ],
        sections=[StudyInfographicSection(heading="Moon", points=["Landed", ""], source_id="x")],
        key_takeaway="k",
    )
    body = post(client, auth, "infographic").json()
    assert [s["value"] for s in body["stats"]] == ["1969"]
    assert body["sections"] == [{"heading": "Moon", "points": ["Landed"], "source_id": None}]


def test_empty_output_falls_back_to_the_next_model(client, auth, study_ai, monkeypatch):
    answers = iter(
        [
            StudyQuizData(title="t", questions=[]),
            StudyQuizData(title="t", questions=[q("Q?", ["a", "b"], 1)]),
        ]
    )

    async def fake(provider, *args, **kwargs):
        await study_ai(provider, *args, **kwargs)
        return next(answers)

    monkeypatch.setattr("app.services.study.complete_json", fake)
    res = post(client, auth, "quiz")
    assert res.status_code == 200
    assert res.json()["questions"][0]["answer_index"] == 1
    assert study_ai.models == ["nv-a", "nv-b"]


def test_502_when_every_provider_fails(client, auth, study_ai):
    study_ai.fail = {"nv-a", "nv-b", "gm-a"}
    assert post(client, auth, "quiz").status_code == 502


def test_rejects_bad_requests(client, auth, study_ai):
    assert post(client, auth, "essay").status_code == 422
    assert post(client, auth, "quiz", count=100).status_code == 422
    res = client.post("/study", json={"kind": "quiz", "documents": []}, headers=auth)
    assert res.status_code == 422


def test_needs_the_internal_token(client, study_ai):
    assert client.post("/study", json={"kind": "quiz", "documents": DOCS}).status_code == 401


def test_share_budget_is_fair():
    docs = [
        StudyDocument(id="a", title="", text="x" * 10),
        StudyDocument(id="b", title="", text="y" * 1000),
        StudyDocument(id="c", title="", text="z" * 1000),
    ]
    cut = share_budget(docs, 210)
    assert [len(t) for t in cut] == [10, 100, 100]
    assert sum(map(len, share_budget(docs, 10_000))) == 2010


def test_request_model_limits():
    with pytest.raises(ValueError):
        StudyRequest(kind="quiz", documents=[DOCS[0]] * 21)
