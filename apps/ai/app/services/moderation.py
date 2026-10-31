"""Moderation of text shown to the whole room (Ask's questions and answers).

Uses Mistral's moderation API when MISTRAL_API_KEY is set. Moderation fails open: without a key,
or when the API errors or times out, the text is allowed and the failure is logged, so Ask never
goes down because moderation did. Only the categories in MODERATION_CATEGORIES block.
"""

import logging

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

MODERATION_URL = "https://api.mistral.ai/v1/moderations"


async def flagged_categories(text: str) -> list[str]:
    """The blocking categories `text` falls into: empty when it is fine or can't be checked."""
    settings = get_settings()
    if not settings.moderation_enabled or not settings.mistral_api_key or not text.strip():
        return []
    blocking = {c.strip() for c in settings.moderation_categories.split(",") if c.strip()}
    try:
        async with httpx.AsyncClient(timeout=settings.moderation_timeout_seconds) as client:
            res = await client.post(
                MODERATION_URL,
                headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
                json={"model": settings.moderation_model, "input": [text]},
            )
            res.raise_for_status()
            categories = res.json()["results"][0]["categories"]
    except Exception as e:  # any failure lets the text through
        log.warning("Moderation unavailable, allowing the text: %r", e)
        return []
    found = sorted(name for name, hit in categories.items() if hit and name in blocking)
    if found:
        log.info("Moderation flagged %s", ", ".join(found))
    return found
