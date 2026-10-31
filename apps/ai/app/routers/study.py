from fastapi import APIRouter, HTTPException

from app.schemas import ErrorResponse, StudyData, StudyRequest
from app.services.study import NoProviderError, StudyError, generate_study

router = APIRouter()


@router.post(
    "/study",
    response_model=StudyData,
    summary="Make a quiz, flashcards, a mind map or an infographic from documents",
    responses={
        502: {"model": ErrorResponse, "description": "All AI providers failed"},
        503: {"model": ErrorResponse, "description": "No AI provider has an API key"},
    },
)
async def study(req: StudyRequest):
    try:
        return await generate_study(req)
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except StudyError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
