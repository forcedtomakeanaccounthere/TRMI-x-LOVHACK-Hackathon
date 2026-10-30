from fastapi import FastAPI

from app.routers import recap

# Internal service: only apps/backend calls it, so no CORS.
app = FastAPI(title="LinkRoom AI")

app.include_router(recap.router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "ai"}
