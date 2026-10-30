import logging

from fastapi import FastAPI

from app.routers import recap
from app.schemas import HealthResponse
from app.services.providers import configured_providers

logging.basicConfig(level=logging.INFO)

# Internal service: only apps/backend calls it, so no CORS.
app = FastAPI(title="LinkRoom AI")

app.include_router(recap.router)


@app.get("/health", summary="Check that the service is up")
async def health() -> HealthResponse:
    # Lists the providers that have a key, in fallback order (never the keys themselves).
    providers = [f"{p.name}:{p.model}" for p in configured_providers()]
    return HealthResponse(ok=True, service="ai", providers=providers)
