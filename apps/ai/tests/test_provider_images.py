"""How a snapshot reaches each SDK: OpenAI-compatible image_url parts, Anthropic base64 blocks."""

import asyncio
from types import SimpleNamespace

from app.schemas import AnswerData
from app.services import providers
from app.services.providers import Provider, complete_json, split_data_url

IMAGE = "data:image/png;base64,iVBORw0K\nGgo="
REPLY = '{"answer": "ok", "found_in_document": false, "citations": []}'


class Recorder:
    def __init__(self, result):
        self.kwargs = None
        self.result = result

    async def __call__(self, **kwargs):
        self.kwargs = kwargs
        return self.result


def test_split_data_url():
    assert split_data_url(IMAGE) == ("image/png", "iVBORw0KGgo=")


def test_openai_compatible_sends_text_then_image_parts(monkeypatch):
    message = SimpleNamespace(content=REPLY)
    create = Recorder(
        SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")])
    )
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(
        providers, "_openai_client", lambda *_: SimpleNamespace(with_options=lambda **_: client)
    )

    out = asyncio.run(
        complete_json(Provider("gemini", "gm-a", "k"), "sys", "question", AnswerData, 5, [IMAGE])
    )
    assert out.answer == "ok"
    content = create.kwargs["messages"][1]["content"]
    assert content == [
        {"type": "text", "text": "question"},
        {"type": "image_url", "image_url": {"url": IMAGE}},
    ]


def test_openai_compatible_without_images_sends_plain_text(monkeypatch):
    message = SimpleNamespace(content=REPLY)
    create = Recorder(
        SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")])
    )
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(
        providers, "_openai_client", lambda *_: SimpleNamespace(with_options=lambda **_: client)
    )

    asyncio.run(complete_json(Provider("nvidia", "nv-a", "k"), "sys", "question", AnswerData, 5))
    assert create.kwargs["messages"][1]["content"] == "question"


def test_anthropic_sends_base64_image_blocks_before_the_text(monkeypatch):
    parsed = AnswerData(answer="ok", found_in_document=False, citations=[])
    parse = Recorder(SimpleNamespace(stop_reason="end_turn", parsed_output=parsed))
    client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(parse=parse)))
    monkeypatch.setattr(
        providers, "_anthropic_client", lambda *_: SimpleNamespace(with_options=lambda **_: client)
    )

    asyncio.run(
        complete_json(
            Provider("anthropic", "claude", "k"), "sys", "question", AnswerData, 5, [IMAGE]
        )
    )
    assert parse.kwargs["messages"][0]["content"] == [
        {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="},
        },
        {"type": "text", "text": "question"},
    ]
