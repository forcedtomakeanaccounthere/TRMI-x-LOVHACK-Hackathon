import json
import logging
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


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class Provider:
    name: str
    model: str
    api_key: str


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


async def _complete_openai_compatible[T: BaseModel](
    provider: Provider, system: str, user: str, schema: type[T]
) -> T:
    system += (
        "\n\nRespond with only a JSON object (no markdown, no extra text) matching this "
        f"JSON Schema:\n{json.dumps(schema.model_json_schema())}"
    )
    response = await _openai_client(provider.name, provider.api_key).chat.completions.create(
        model=provider.model,
        max_tokens=MAX_TOKENS,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    choice = response.choices[0]
    if not choice.message.content:
        raise ProviderError(f"empty response (finish_reason={choice.finish_reason})")
    return schema.model_validate_json(_extract_json(choice.message.content))


async def _complete_anthropic[T: BaseModel](
    provider: Provider, system: str, user: str, schema: type[T]
) -> T:
    response = await _anthropic_client(provider.api_key).beta.messages.parse(
        model=provider.model,
        max_tokens=MAX_TOKENS,
        output_config={"effort": "low"},
        output_format=schema,
        # On a policy refusal, the API re-runs the request on a fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise ProviderError(f"no output (stop_reason={response.stop_reason})")
    return response.parsed_output


async def complete_json[T: BaseModel](
    provider: Provider, system: str, user: str, schema: type[T]
) -> T:
    """Ask one provider for a JSON answer validated against `schema`."""
    if provider.name == "anthropic":
        return await _complete_anthropic(provider, system, user, schema)
    return await _complete_openai_compatible(provider, system, user, schema)
