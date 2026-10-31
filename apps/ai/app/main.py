import logging

from fastapi import FastAPI

from app.routers import recap
from app.services.providers import configured_providers

logging.basicConfig(level=logging.INFO)

# Internal service: only apps/backend calls it, so no CORS.
app = FastAPI(title="LinkRoom AI")

app.include_router(recap.router)


@app.get("/health")
async def health() -> dict:
    # Lists the providers that have a key, in fallback order (never the keys themselves).
    providers = [f"{p.name}:{p.model}" for p in configured_providers()]
    return {"ok": True, "service": "ai", "providers": providers}
