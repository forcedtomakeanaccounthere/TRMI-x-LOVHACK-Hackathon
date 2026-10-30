import json
from functools import lru_cache

import anthropic

from app.config import get_settings
from app.schemas import RecapData, RecapRequest

SYSTEM_PROMPT = (
    "You summarize a group's shared reading session. Focus on what the people "
    "highlighted and discussed, not just the document."
)


class RecapError(Exception):
    pass


@lru_cache
def get_client() -> anthropic.AsyncAnthropic:
    # Reads ANTHROPIC_API_KEY (or an `ant auth login` profile) when api_key is None.
    return anthropic.AsyncAnthropic(api_key=get_settings().anthropic_api_key)


async def generate_recap(req: RecapRequest) -> RecapData:
    settings = get_settings()
    document = req.text[: settings.max_document_chars]
    highlights = json.dumps([h.model_dump() for h in req.highlights])
    comments = json.dumps([c.model_dump() for c in req.comments])

    response = await get_client().beta.messages.parse(
        model=settings.anthropic_model,
        max_tokens=16000,
        output_config={"effort": "low"},
        output_format=RecapData,
        # On a policy refusal, the API re-runs the request on a fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Document: {req.title}\n\n{document}\n\n"
                    f"Highlights:\n{highlights}\n\nComments:\n{comments}"
                ),
            }
        ],
    )

    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise RecapError(f"Recap failed (stop_reason={response.stop_reason})")
    return response.parsed_output
