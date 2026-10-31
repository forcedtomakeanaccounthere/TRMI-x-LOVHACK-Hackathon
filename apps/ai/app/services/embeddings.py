import logging
import math
import time
from typing import Literal

from app.config import get_settings
from app.services.providers import _openai_client

log = logging.getLogger(__name__)

InputType = Literal["passage", "query"]


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
    elif provider == "gemini":
        kwargs["dimensions"] = dim

    start = time.monotonic()
    try:
        response = await _create(provider, api_key, model, texts, **kwargs)
    except Exception as e:
        # The texts are document content: never logged.
        log.warning("embed %s:%s failed for %d texts: %s", provider, model, len(texts), e)
        raise EmbeddingError(f"{provider}:{model} failed") from e

    data = sorted(response.data, key=lambda d: d.index)
    vectors = [list(d.embedding) for d in data]
    if len(vectors) != len(texts):
        raise EmbeddingError(
            f"{provider}:{model} returned {len(vectors)} vectors for {len(texts)} texts"
        )
    for vector in vectors:
        if len(vector) != dim:
            raise EmbeddingError(
                f"{provider}:{model} returned {len(vector)} numbers, EMBEDDING_DIM is {dim}"
            )
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in vector):
            raise EmbeddingError(f"{provider}:{model} returned a vector that isn't all numbers")

    log.info(
        "embed %s:%s %d %s texts in %.0f ms",
        provider,
        model,
        len(texts),
        input_type,
        (time.monotonic() - start) * 1000,
    )
    return model, vectors
