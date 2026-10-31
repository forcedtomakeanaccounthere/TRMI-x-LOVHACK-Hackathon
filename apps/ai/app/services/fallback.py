"""One AI call that falls back across the configured providers, used by the summary and the
answers. (The recap keeps its own loop, which logs a recap's details.)"""

import asyncio
import logging
import time

from pydantic import BaseModel

from app.services.providers import (
    available,
    complete_json,
    configured_providers,
    record_failure,
    record_success,
)

log = logging.getLogger(__name__)

# Not worth starting a provider call with less time than this left.
MIN_ATTEMPT_SECONDS = 5.0


class AllProvidersFailed(Exception):
    pass


async def complete_with_fallback[T: BaseModel](
    label: str,
    system: str,
    user: str,
    schema: type[T],
    *,
    deadline: float,
    attempt_seconds: float,
    min_attempt_seconds: float = MIN_ATTEMPT_SECONDS,
) -> T:
    """Asks each provider in turn (skipping ones whose breaker is open) until one returns valid
    JSON for `schema`. Each attempt gets at most `attempt_seconds`, and none starts with less than
    `min_attempt_seconds` left before `deadline` (a time.monotonic() value)."""
    failures = []
    for provider in available(configured_providers()):
        remaining = deadline - time.monotonic()
        if remaining < min_attempt_seconds:
            failures.append("deadline reached")
            break
        started = time.monotonic()
        timeout = min(attempt_seconds, remaining)
        try:
            # The SDK timeout is per HTTP request and the client retries once; wait_for cancels the
            # whole attempt when its share of the deadline runs out.
            result = await asyncio.wait_for(
                complete_json(provider, system, user, schema, timeout=timeout), timeout=timeout
            )
        except Exception as e:
            record_failure(provider)
            log.warning(
                "%s via %s (%s) failed after %.1f s: %s",
                label,
                provider.name,
                provider.model,
                time.monotonic() - started,
                type(e).__name__,
            )
            failures.append(f"{provider.name}: {type(e).__name__}")
            continue
        record_success(provider)
        log.info(
            "%s by %s (%s) in %.1f s after %d fallback(s)",
            label,
            provider.name,
            provider.model,
            time.monotonic() - started,
            len(failures),
        )
        return result
    raise AllProvidersFailed(f"{label}: all AI providers failed ({', '.join(failures)})")
