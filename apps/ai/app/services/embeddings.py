import logging
import math
import time
from typing import Literal

from app.config import get_settings
from app.services.providers import _openai_client

log = logging.getLogger(__name__)

InputType = Literal["passage", "query"]


# NVIDIA models whose vectors have one fixed size and refuse a `dimensions` parameter.
FIXED_SIZE_MODELS = frozenset({"nvidia/nv-embedqa-e5-v5", "nvidia/nv-embedqa-mistral-7b-v2"})


class EmbeddingError(Exception):
    pass


class NoEmbeddingProviderError(EmbeddingError):
    pass


async def _create(provider: str, api_key: str, model: str, texts: list[str], **kwargs):
    """One embeddings request (OpenAI-compatible API). Replaced in tests."""
    settings = get_settings()
    client = _openai_client(provider, api_key).with_options(
        timeout=settings.embedding_timeout_seconds
    )
    return await client.embeddings.create(model=model, input=texts, **kwargs)


async def embed(texts: list[str], input_type: InputType) -> tuple[str, list[list[float]]]:
    """Embeds `texts` with the configured provider and model. Returns (model, vectors), one vector
    of EMBEDDING_DIM numbers per text, in order. No fallback: a failure raises EmbeddingError."""
    settings = get_settings()
    provider, model, dim = (
        settings.embedding_provider,
        settings.embedding_model,
        settings.embedding_dim,
    )
    api_key = getattr(settings, f"{provider}_api_key")
    if not api_key:
        raise NoEmbeddingProviderError(f"{provider.upper()}_API_KEY is not set for embeddings")

    # Plain floats: without this the SDK asks for base64, which not every provider supports.
    kwargs: dict = {"encoding_format": "float"}
    if provider == "nvidia":
        # NVIDIA's retrieval models embed documents and questions differently, and refuse input
        # over their token limit unless told to cut it.
        kwargs["extra_body"] = {"input_type": input_type, "truncate": "END"}
        # Newer ones (llama-3.2-nv-embedqa-1b-v2) make vectors of several sizes: ask for the
        # column's.
        if model not in FIXED_SIZE_MODELS:
            kwargs["dimensions"] = dim
    elif provider == "gemini":
        kwargs["dimensions"] = dim

    start = time.monotonic()
    try:
        response = await _create(provider, api_key, model, texts, **kwargs)
    except Exception as e:
        # Only the error's type and HTTP status: a provider may echo the texts (document content)
        # back in its error message.
        log.warning(
            "embed %s:%s failed for %d texts: %s (status %s)",
            provider,
            model,
            len(texts),
            type(e).__name__,
            getattr(e, "status_code", "-"),
        )
        raise EmbeddingError(f"{provider}:{model} failed") from e

    vectors = _vectors(response, len(texts), dim, f"{provider}:{model}")
    log.info(
        "embed %s:%s %d %s texts in %.0f ms",
        provider,
        model,
        len(texts),
        input_type,
        (time.monotonic() - start) * 1000,
    )
    return model, vectors


def _vectors(response, count: int, dim: int, name: str) -> list[list[float]]:
    """The vectors of an embeddings response in input order, after checking its whole shape: an
    entry for every index 0..count-1 exactly once, each EMBEDDING_DIM finite numbers. Anything else
    raises EmbeddingError, so no vector can land on the wrong chunk."""
    try:
        by_index: dict[int, list[float]] = {}
        for item in response.data:
            index = item.index
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < count:
                raise EmbeddingError(f"{name} returned an entry with index {index!r}")
            if index in by_index:
                raise EmbeddingError(f"{name} returned index {index} twice")
            by_index[index] = list(item.embedding)
    except EmbeddingError:
        raise
    except Exception as e:  # missing fields, a non-list embedding, ...
        raise EmbeddingError(f"{name} returned a malformed response ({type(e).__name__})") from e

    if len(by_index) != count:
        raise EmbeddingError(f"{name} returned {len(by_index)} vectors for {count} texts")
    vectors = [by_index[i] for i in range(count)]
    for vector in vectors:
        if len(vector) != dim:
            raise EmbeddingError(f"{name} returned {len(vector)} numbers, EMBEDDING_DIM is {dim}")
        if not all(
            isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
            for x in vector
        ):
            raise EmbeddingError(f"{name} returned a vector that isn't all numbers")
    return vectors
