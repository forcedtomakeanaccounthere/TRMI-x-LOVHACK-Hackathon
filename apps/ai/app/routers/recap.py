import anthropic
from fastapi import APIRouter, HTTPException

from app.schemas import RecapData, RecapRequest
from app.services.recap import RecapError, generate_recap

router = APIRouter()


@router.post("/recap", response_model=RecapData)
async def recap(req: RecapRequest) -> RecapData:
    try:
        return await generate_recap(req)
    except RecapError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except anthropic.RateLimitError as e:
        raise HTTPException(status_code=429, detail="AI is busy, try again shortly") from e
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"AI provider error ({e.status_code})") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=503, detail="Could not reach the AI provider") from e
