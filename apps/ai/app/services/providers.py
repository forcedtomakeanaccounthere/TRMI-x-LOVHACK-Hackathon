import json
import logging
import time
from dataclasses import dataclass
from functools import lru_cache

import anthropic
import openai
from pydantic import BaseModel

from app.config import get_settings

log = logging.getLogger(__name__)

# These expose an OpenAI-compatible Chat Completions API; Anthropic uses its own SDK.
OPENAI_COMPATIBLE_BASE_URLS = {
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "mistral": "https://api.mistral.ai/v1",
}
SUPPORTED_PROVIDERS = (*OPENAI_COMPATIBLE_BASE_URLS, "anthropic")

MAX_TOKENS = 16000

# Circuit breaker: a model that failed this many times within the window is skipped until the
# window has passed, so every request doesn't sit through its timeout first.
BREAKER_FAILURES = 3
BREAKER_WINDOW_SECONDS = 120.0


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class Provider:
    name: str
    model: str
    api_key: str


_failures: dict[tuple[str, str], list[float]] = {}


def _recent_failures(provider: Provider) -> list[float]:
    key = (provider.name, provider.model)
    cutoff = time.monotonic() - BREAKER_WINDOW_SECONDS
    _failures[key] = [t for t in _failures.get(key, []) if t > cutoff]
    return _failures[key]


def is_open(provider: Provider) -> bool:
    """True while the provider's model has failed too often recently to be worth trying."""
    return len(_recent_failures(provider)) >= BREAKER_FAILURES


def record_failure(provider: Provider) -> None:
    _recent_failures(provider).append(time.monotonic())


def record_success(provider: Provider) -> None:
    _failures.pop((provider.name, provider.model), None)


def available(providers: list[Provider]) -> list[Provider]:
    """Providers whose breaker is closed. If every breaker is open, try them all anyway:
    an outage that has ended should not keep the feature down until the window passes."""
    return [p for p in providers if not is_open(p)] or providers


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def configured_providers() -> list[Provider]:
    """(provider, model) pairs to try in order: AI_PROVIDERS order, then each *_MODEL list."""
    settings = get_settings()
    providers = []
    for name in (n.lower() for n in _split(settings.ai_providers)):
        if name not in SUPPORTED_PROVIDERS:
            log.warning("Unknown AI provider %r in AI_PROVIDERS, skipping", name)
            continue
        api_key = getattr(settings, f"{name}_api_key")
        if api_key:
            for model in _split(getattr(settings, f"{name}_model")):
                providers.append(Provider(name, model, api_key))
    return providers


@lru_cache
def _openai_client(name: str, api_key: str) -> openai.AsyncOpenAI:
    # One retry only: on repeated failure we'd rather move on to the next provider.
    return openai.AsyncOpenAI(
        api_key=api_key,
        base_url=OPENAI_COMPATIBLE_BASE_URLS[name],
        timeout=get_settings().ai_timeout_seconds,
        max_retries=1,
    )


@lru_cache
def _anthropic_client(api_key: str) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(
        api_key=api_key, timeout=get_settings().ai_timeout_seconds, max_retries=1
    )


def _extract_json(text: str) -> str:
    # Some models wrap JSON in ``` fences or add text around it.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise ProviderError("response contained no JSON object")
    return text[start : end + 1]


def split_data_url(url: str) -> tuple[str, str]:
    """("image/jpeg", "<base64>") from a data URL that app/schemas.py already checked."""
    head, data = url.split(",", 1)
    return head.removeprefix("data:").removesuffix(";base64"), "".join(data.split())


async def _complete_openai_compatible[T: BaseModel](
    provider: Provider,
    system: str,
    user: str,
    schema: type[T],
    timeout: float,
    images: list[str] | None = None,
) -> T:
    system += (
        "\n\nRespond with only a JSON object (no markdown, no extra text) matching this "
        f"JSON Schema:\n{json.dumps(schema.model_json_schema())}"
    )
    content: str | list[dict] = user
    if images:
        content = [
            {"type": "text", "text": user},
            *({"type": "image_url", "image_url": {"url": url}} for url in images),
        ]
    client = _openai_client(provider.name, provider.api_key).with_options(timeout=timeout)
    response = await client.chat.completions.create(
        model=provider.model,
        max_tokens=MAX_TOKENS,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
    )
    choice = response.choices[0]
    if not choice.message.content:
        raise ProviderError(f"empty response (finish_reason={choice.finish_reason})")
    return schema.model_validate_json(_extract_json(choice.message.content))


async def _complete_anthropic[T: BaseModel](
    provider: Provider,
    system: str,
    user: str,
    schema: type[T],
    timeout: float,
    images: list[str] | None = None,
) -> T:
    content: str | list[dict] = user
    if images:
        blocks = []
        for url in images:
            media_type, data = split_data_url(url)
            source = {"type": "base64", "media_type": media_type, "data": data}
            blocks.append({"type": "image", "source": source})
        content = [*blocks, {"type": "text", "text": user}]
    client = _anthropic_client(provider.api_key).with_options(timeout=timeout)
    response = await client.beta.messages.parse(
        model=provider.model,
        max_tokens=MAX_TOKENS,
        output_config={"effort": "low"},
        output_format=schema,
        # On a policy refusal, the API re-runs the request on a fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise ProviderError(f"no output (stop_reason={response.stop_reason})")
    return response.parsed_output


async def complete_json[T: BaseModel](
    provider: Provider,
    system: str,
    user: str,
    schema: type[T],
    timeout: float,
    images: list[str] | None = None,
) -> T:
    """Ask one provider for a JSON answer validated against `schema`, within `timeout` seconds.
    `images` (data URLs) go with the user message; only send them to a vision model."""
    if provider.name == "anthropic":
        return await _complete_anthropic(provider, system, user, schema, timeout, images)
    return await _complete_openai_compatible(provider, system, user, schema, timeout, images)


def vision_providers(providers: list[Provider]) -> list[Provider]:
    """The providers whose model can read images (VISION_MODELS)."""
    vision = set(_split(get_settings().vision_models))
    return [p for p in providers if p.model in vision]
