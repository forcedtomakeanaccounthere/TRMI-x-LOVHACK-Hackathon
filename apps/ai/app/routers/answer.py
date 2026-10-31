from fastapi import APIRouter, HTTPException

from app.schemas import AnswerRequest, AnswerResult, ErrorResponse
from app.services.answer import (
    AnswerError,
    InvalidQuestion,
    NoProviderError,
    answer_question,
)

router = APIRouter()


@router.post(
    "/answer",
    response_model=AnswerResult,
    summary="Answer a question from a room's chunks, with checked citations",
    responses={
        502: {"model": ErrorResponse, "description": "All AI providers failed"},
        422: {"description": "Invalid request, or a question with nothing in it"},
        503: {"model": ErrorResponse, "description": "No AI provider has an API key"},
    },
)
async def answer(req: AnswerRequest) -> AnswerResult:
    try:
        return await answer_question(req)
    except InvalidQuestion as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except AnswerError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
