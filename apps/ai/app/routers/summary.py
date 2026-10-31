from fastapi import APIRouter, HTTPException

from app.schemas import ErrorResponse, RoomSummary, SummaryRequest
from app.services.summary import NoProviderError, SummaryError, generate_summary

router = APIRouter()


@router.post(
    "/summary",
    response_model=RoomSummary,
    summary="Write a detailed summary of a room from its chunks",
    responses={
        502: {"model": ErrorResponse, "description": "All AI providers failed"},
        503: {"model": ErrorResponse, "description": "No AI provider has an API key"},
    },
)
async def summary(req: SummaryRequest) -> RoomSummary:
    try:
        return await generate_summary(req)
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except SummaryError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
