from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    # Providers are tried in this order until one succeeds; ones without an API key are skipped.
    ai_providers: str = "nvidia,gemini,mistral,anthropic"
    # Per request to a provider, so a hanging provider doesn't block the fallback.
    ai_timeout_seconds: float = 90.0

    # Each *_model may be a comma-separated list, tried in order before moving to the next provider.
    # Defaults are the strongest models that worked on free tiers (checked 2026-10-31).
    nvidia_api_key: str | None = None
    nvidia_model: str = (
        "nvidia/nemotron-3-ultra-550b-a55b,"
        "nvidia/nemotron-3.5-super-vl-120b-a12b,"
        "nvidia/nemotron-3.5-lightning-30b-a3b"
    )
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash,gemini-3.5-flash-lite"
    mistral_api_key: str | None = None
    mistral_model: str = "ministral-14b-latest"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"

    # Documents longer than this are cut before being sent to the model (known limit).
    max_document_chars: int = 60_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
