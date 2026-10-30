from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../../.env", extra="ignore")

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    # Documents longer than this are cut before being sent to Claude (known limit).
    max_document_chars: int = 60_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
