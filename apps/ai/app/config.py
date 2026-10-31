from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    # Set ENVIRONMENT=production on the host. Production refuses to start without a token.
    environment: Literal["development", "test", "production"] = "development"
    # Shared secret: apps/backend sends it as X-Internal-Token. Optional in development only.
    ai_internal_token: str | None = None

    # Providers are tried in this order until one succeeds; ones without an API key are skipped.
    ai_providers: str = "nvidia,gemini,mistral,anthropic"
    # Per request to a provider, so a hanging provider doesn't block the fallback.
    ai_timeout_seconds: float = 90.0
    # Whole fallback chain for one recap. Below apps/backend's 120 s timeout, so the backend gets
    # our 502 instead of giving up first while we keep spending tokens.
    recap_deadline_seconds: float = 100.0

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

    # Detailed summary (POST /summary): one map call per group of chunks, then one reduce call.
    # Each call is capped like a recap call and falls back across providers within
    # summary_call_deadline_seconds; the whole summary must finish within summary_deadline_seconds,
    # below apps/backend's 600 s timeout for it.
    summary_call_timeout_seconds: float = 60.0
    summary_call_deadline_seconds: float = 100.0
    summary_deadline_seconds: float = 540.0

    # Answers (POST /answer): someone is waiting in the room, so one call gets 25 s in all,
    # below apps/backend's 30 s timeout for it.
    answer_deadline_seconds: float = 25.0
    # One provider's share, so a provider that hangs still leaves time to fall back to the next.
    answer_attempt_seconds: float = 10.0

    # Embeddings (POST /embed) use one provider and model, with no fallback: vectors from different
    # models can't be compared, so mixing them would break search. When it fails, apps/backend
    # falls back to keyword search. The key is the provider's *_API_KEY above.
    # nvidia/nv-embedqa-e5-v5 and mistral (mistral-embed) give 1024 numbers; gemini is asked for
    # EMBEDDING_DIM. EMBEDDING_DIM must match the vector column in
    # supabase/migrations/0011_chunks.sql.
    embedding_provider: Literal["nvidia", "gemini", "mistral"] = "nvidia"
    embedding_model: str = "nvidia/nv-embedqa-e5-v5"
    embedding_dim: int = 1024
    embedding_timeout_seconds: float = 30.0

    @model_validator(mode="after")
    def _token_in_production(self) -> "Settings":
        if self.environment == "production" and not self.ai_internal_token:
            raise ValueError("AI_INTERNAL_TOKEN is required when ENVIRONMENT=production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
