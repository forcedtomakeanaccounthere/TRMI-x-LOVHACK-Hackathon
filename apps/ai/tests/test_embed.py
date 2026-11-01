import logging
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.schemas import MAX_EMBED_TEXTS

DIM = 1024


def vector(seed: float, dim: int = DIM) -> list[float]:
    return [seed] * dim


class FakeEmbeddings:
    """Stands in for the provider's embeddings API, recording each request."""

    def __init__(self):
        self.calls: list[dict] = []
        self.error: Exception | None = None
        self.dim = DIM
        self.shuffle = False
        self.drop_one = False
        self.bad_value = False
        self.mutate = None  # optional function that changes the response data

    async def __call__(self, provider, api_key, model, texts, **kwargs):
        self.calls.append({"provider": provider, "model": model, "texts": texts, **kwargs})
        if self.error:
            raise self.error
        data = [
            SimpleNamespace(index=i, embedding=vector(float(i), self.dim))
            for i in range(len(texts))
        ]
        if self.bad_value:
            data[0].embedding[0] = float("nan")
        if self.drop_one:
            data = data[:-1]
        if self.shuffle:
            data.reverse()
        if self.mutate:
            data = self.mutate(data)
        return SimpleNamespace(data=data)


@pytest.fixture
def fake_embeddings(monkeypatch):
    fake = FakeEmbeddings()
    monkeypatch.setattr("app.services.embeddings._create", fake)
    return fake


def post(client, auth, texts, **extra):
    return client.post("/embed", json={"texts": texts, **extra}, headers=auth)


def test_needs_the_internal_token(client, fake_embeddings):
    assert client.post("/embed", json={"texts": ["a"]}).status_code == 401
    assert fake_embeddings.calls == []


def test_returns_one_vector_per_text_in_order(client, auth, fake_embeddings):
    fake_embeddings.shuffle = True  # providers may answer out of order; `index` says which is which
    res = post(client, auth, ["first", "second", "third"])
    assert res.status_code == 200
    body = res.json()
    assert body["model"] == "nvidia/llama-3.2-nv-embedqa-1b-v2"
    assert [v[0] for v in body["vectors"]] == [0.0, 1.0, 2.0]
    assert all(len(v) == DIM for v in body["vectors"])


@pytest.mark.parametrize("input_type", ["passage", "query"])
def test_nvidia_gets_the_input_type_and_truncation(client, auth, fake_embeddings, input_type):
    post(client, auth, ["text"], input_type=input_type)
    (call,) = fake_embeddings.calls
    assert call["provider"] == "nvidia"
    assert call["extra_body"] == {"input_type": input_type, "truncate": "END"}
    assert call["encoding_format"] == "float"


def test_nvidia_is_asked_for_the_column_size_unless_the_model_has_one_size(
    client, auth, fake_embeddings, monkeypatch
):
    post(client, auth, ["text"])
    assert fake_embeddings.calls[0]["dimensions"] == DIM
    monkeypatch.setenv("EMBEDDING_MODEL", "nvidia/nv-embedqa-e5-v5")
    get_settings.cache_clear()
    post(client, auth, ["text"])
    assert "dimensions" not in fake_embeddings.calls[1]


def test_passage_is_the_default(client, auth, fake_embeddings):
    post(client, auth, ["text"])
    assert fake_embeddings.calls[0]["extra_body"]["input_type"] == "passage"


def test_gemini_is_asked_for_the_dimension(client, auth, fake_embeddings, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "gemini")
    monkeypatch.setenv("EMBEDDING_MODEL", "gemini-embedding-001")
    get_settings.cache_clear()
    assert post(client, auth, ["text"]).status_code == 200
    (call,) = fake_embeddings.calls
    assert (call["provider"], call["dimensions"]) == ("gemini", DIM)
    assert "extra_body" not in call


def test_mistral_gets_no_extra_parameters(client, auth, fake_embeddings, monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "mistral")
    monkeypatch.setenv("EMBEDDING_MODEL", "mistral-embed")
    monkeypatch.setenv("MISTRAL_API_KEY", "ms-key")
    get_settings.cache_clear()
    assert post(client, auth, ["text"]).status_code == 200
    (call,) = fake_embeddings.calls
    assert call["provider"] == "mistral"
    assert set(call) == {"provider", "model", "texts", "encoding_format"}


def test_answers_503_without_a_key_for_the_embedding_provider(
    client, auth, fake_embeddings, monkeypatch
):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "mistral")  # MISTRAL_API_KEY is empty in tests
    get_settings.cache_clear()
    res = post(client, auth, ["text"])
    assert res.status_code == 503
    assert "MISTRAL_API_KEY" in res.json()["detail"]
    assert fake_embeddings.calls == []


def test_has_no_fallback_when_the_provider_fails(client, auth, fake_embeddings, caplog):
    # Some providers echo the input back in their error message.
    fake_embeddings.error = RuntimeError("invalid input: secret document text")
    with caplog.at_level(logging.WARNING):
        res = post(client, auth, ["secret document text"])
    assert res.status_code == 502
    # Vectors from another model wouldn't match the room's other vectors: only one attempt.
    assert len(fake_embeddings.calls) == 1
    assert "secret document text" not in caplog.text


@pytest.mark.parametrize(
    "fault", ["wrong dimension", "missing vector", "not a number"], ids=lambda f: f
)
def test_refuses_vectors_that_would_not_fit_the_index(client, auth, fake_embeddings, fault):
    if fault == "wrong dimension":
        fake_embeddings.dim = 768
    elif fault == "missing vector":
        fake_embeddings.drop_one = True
    else:
        fake_embeddings.bad_value = True
    res = post(client, auth, ["a", "b"])
    assert res.status_code == 502


def entry(index, embedding=None):
    return SimpleNamespace(index=index, embedding=embedding or vector(1.0))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda data: [entry(0), entry(0)],  # a duplicate index, the other text left without one
        lambda data: [entry(0), entry(2)],  # an index past the texts
        lambda data: [entry(-1), entry(1)],
        lambda data: [entry("0"), entry(1)],  # not a number
        lambda data: [entry(True), entry(1)],
        lambda data: [SimpleNamespace(index=0), entry(1)],  # no embedding
        lambda data: [entry(0, embedding=42), entry(1)],  # an embedding that isn't a list
        lambda data: [entry(0), entry(1, embedding=[True] * DIM)],
    ],
    ids=[
        "duplicate",
        "out of range",
        "negative",
        "string index",
        "bool index",
        "no embedding",
        "embedding not a list",
        "booleans",
    ],
)
def test_refuses_a_malformed_response_as_a_502(client, auth, fake_embeddings, mutate):
    fake_embeddings.mutate = mutate
    res = post(client, auth, ["a", "b"])
    assert res.status_code == 502


@pytest.mark.parametrize(
    "texts",
    [[], [""], ["x" * 8001], ["a"] * (MAX_EMBED_TEXTS + 1)],
    ids=["none", "empty text", "too long", "too many"],
)
def test_validates_the_request(client, auth, fake_embeddings, texts):
    assert post(client, auth, texts).status_code == 422
    assert fake_embeddings.calls == []


def test_refuses_an_unknown_input_type(client, auth, fake_embeddings):
    assert post(client, auth, ["a"], input_type="document").status_code == 422
