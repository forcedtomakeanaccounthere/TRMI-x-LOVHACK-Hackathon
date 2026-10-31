import logging
import re
import time

from fastapi import Depends, FastAPI, Request

from app.config import get_settings
from app.context import RequestIdFilter, request_id
from app.routers import answer, embed, extras, moderate, recap, summary, transcript
from app.schemas import HealthResponse
from app.security import require_internal
from app.services.providers import configured_providers

logging.basicConfig(
    level=logging.INFO, format="%(levelname)s %(name)s [%(request_id)s] %(message)s"
)
for handler in logging.getLogger().handlers:
    handler.addFilter(RequestIdFilter())
log = logging.getLogger(__name__)

# Fail at boot, not on the first request, if production is missing AI_INTERNAL_TOKEN.
get_settings()

# Internal service: only apps/backend calls it, so no CORS. AI routes need X-Internal-Token.
app = FastAPI(title="LinkRoom AI")

app.include_router(recap.router, dependencies=[Depends(require_internal)])
app.include_router(embed.router, dependencies=[Depends(require_internal)])
app.include_router(summary.router, dependencies=[Depends(require_internal)])
app.include_router(answer.router, dependencies=[Depends(require_internal)])
app.include_router(transcript.router, dependencies=[Depends(require_internal)])
app.include_router(moderate.router, dependencies=[Depends(require_internal)])
app.include_router(extras.router, dependencies=[Depends(require_internal)])

REQUEST_ID = re.compile(r"^[\w-]{1,64}$")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    rid = request.headers.get("x-request-id", "")
    token = request_id.set(rid if REQUEST_ID.match(rid) else "-")
    start = time.monotonic()
    try:
        response = await call_next(request)
        log.info(
            "%s %s -> %s in %.0f ms",
            request.method,
            request.url.path,
            response.status_code,
            (time.monotonic() - start) * 1000,
        )
        return response
    finally:
        request_id.reset(token)


@app.get("/health", summary="Check that the service is up")
async def health() -> HealthResponse:
    # Lists the providers that have a key, in fallback order (never the keys themselves).
    providers = [f"{p.name}:{p.model}" for p in configured_providers()]
    return HealthResponse(ok=True, service="ai", providers=providers)
