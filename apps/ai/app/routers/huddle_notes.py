from fastapi import APIRouter, HTTPException

from app.schemas import ErrorResponse, HuddleNotesData, HuddleNotesRequest
from app.services.huddle_notes import HuddleNotesError, NoProviderError, generate_huddle_notes

router = APIRouter()


@router.post(
    "/huddle-notes",
    response_model=HuddleNotesData,
    summary="Generate meeting notes from a voice huddle transcript",
    responses={
        502: {"model": ErrorResponse, "description": "All AI providers failed"},
        503: {"model": ErrorResponse, "description": "No AI provider has an API key"},
    },
)
async def huddle_notes(req: HuddleNotesRequest) -> HuddleNotesData:
    try:
        return await generate_huddle_notes(req)
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except HuddleNotesError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
