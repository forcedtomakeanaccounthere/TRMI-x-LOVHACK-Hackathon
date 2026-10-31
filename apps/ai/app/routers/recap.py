from fastapi import APIRouter, HTTPException

from app.schemas import RecapData, RecapRequest
from app.services.recap import NoProviderError, RecapError, generate_recap

router = APIRouter()


@router.post("/recap", response_model=RecapData)
async def recap(req: RecapRequest) -> RecapData:
    try:
        return await generate_recap(req)
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except RecapError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
