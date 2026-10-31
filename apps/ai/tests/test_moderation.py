import asyncio
import json

import httpx
import pytest

from app.config import get_settings
from app.schemas import AnswerData, Citation
from app.services.answer import WITHHELD
from app.services.moderation import MODERATION_URL, flagged_categories
from tests.test_answer import FakeAnswerAI, ask

QUESTION = "How do plants get energy?"


def categories(**hits):
    names = ["sexual", "hate_and_discrimination", "violence_and_threats", "selfharm", "health"]
    return {name: hits.get(name, False) for name in names}


class Moderation:
    """Stands in for Mistral's moderation API: flags the texts in `flag` with their categories."""

    def __init__(self):
        self.flag: dict[str, dict[str, bool]] = {}
        self.status = 200
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(
            {"url": str(request.url), "auth": request.headers["authorization"], **body}
        )
        if self.status != 200:
            return httpx.Response(self.status)
        text = body["input"][0]
        return httpx.Response(
            200, json={"results": [{"categories": self.flag.get(text, categories())}]}
        )


@pytest.fixture
def answer_ai(monkeypatch, clock):
    ai = FakeAnswerAI()
    monkeypatch.setattr("app.services.fallback.complete_json", ai)
    return ai


@pytest.fixture
def moderation(monkeypatch):
    mod = Moderation()
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-key")
    get_settings.cache_clear()
    real = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.moderation.httpx.AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(mod.handler), **kw),
    )
    return mod


class TestFlaggedCategories:
    async def check(self, text):
        return await flagged_categories(text)

    def test_returns_only_blocking_categories_that_hit(self, moderation):
        moderation.flag["bad"] = categories(hate_and_discrimination=True, health=True)
        assert asyncio.run(self.check("bad")) == ["hate_and_discrimination"]
        assert moderation.requests[0]["url"] == MODERATION_URL
        assert moderation.requests[0]["auth"] == "Bearer mistral-key"
        assert moderation.requests[0]["model"] == "mistral-moderation-latest"

    def test_allows_clean_text(self, moderation):
        assert asyncio.run(self.check("fine")) == []

    @pytest.mark.parametrize("status", [429, 500])
    def test_fails_open_when_the_api_errors(self, moderation, status, caplog):
        moderation.status = status
        assert asyncio.run(self.check("anything")) == []
        assert "Moderation unavailable" in caplog.text

    def test_is_skipped_without_a_key_or_when_disabled(self, moderation, monkeypatch):
        monkeypatch.setenv("MISTRAL_API_KEY", "")
        get_settings.cache_clear()
        assert asyncio.run(self.check("bad")) == []
        monkeypatch.setenv("MISTRAL_API_KEY", "mistral-key")
        monkeypatch.setenv("MODERATION_ENABLED", "false")
        get_settings.cache_clear()
        assert asyncio.run(self.check("bad")) == []
        assert moderation.requests == []


class TestAskModeration:
    def test_a_flagged_question_is_refused_before_any_model_call(
        self, client, auth, answer_ai, moderation
    ):
        moderation.flag["I will hurt them"] = categories(violence_and_threats=True)
        res = ask(client, auth, question="I will hurt them")
        assert res.status_code == 400
        assert "violence_and_threats" in res.json()["detail"]
        assert answer_ai.calls == []

    def test_a_flagged_answer_is_withheld(self, client, auth, answer_ai, moderation):
        answer_ai.answer = AnswerData(
            answer="Hateful text",
            found_in_document=True,
            citations=[Citation(chunk=1, quote="Photosynthesis turns sunlight")],
        )
        moderation.flag["Hateful text"] = categories(hate_and_discrimination=True)
        body = ask(client, auth, question=QUESTION).json()
        assert body == {"answer": WITHHELD, "found_in_document": False, "citations": []}

    def test_clean_questions_and_answers_pass(self, client, auth, answer_ai, moderation):
        answer_ai.answer = AnswerData(
            answer="Plants use photosynthesis.",
            found_in_document=True,
            citations=[Citation(chunk=1, quote="Photosynthesis turns sunlight")],
        )
        body = ask(client, auth, question=QUESTION).json()
        assert body["found_in_document"] is True
        assert [r["input"][0] for r in moderation.requests] == [
            QUESTION,
            "Plants use photosynthesis.",
        ]
