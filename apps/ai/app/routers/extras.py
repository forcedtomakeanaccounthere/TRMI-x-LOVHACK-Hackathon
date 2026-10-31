from fastapi import APIRouter, HTTPException

from app.schemas import (
    CatchupData,
    CatchupRequest,
    ErrorResponse,
    ExplainRequest,
    ExplainResult,
    QuizData,
    QuizRequest,
)
from app.services.extras import ExtrasError, NoProviderError, catch_up, explain, make_quiz

router = APIRouter()
ERRORS = {
    502: {"model": ErrorResponse, "description": "All AI providers failed"},
    503: {"model": ErrorResponse, "description": "No AI provider has an API key"},
}


async def run(coro):
    try:
        return await coro
    except NoProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ExtrasError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/catchup", response_model=CatchupData, responses=ERRORS, summary="Catch me up")
async def catchup_route(req: CatchupRequest) -> CatchupData:
    return await run(catch_up(req))


@router.post(
    "/explain", response_model=ExplainResult, responses=ERRORS, summary="Explain a highlight"
)
async def explain_route(req: ExplainRequest) -> ExplainResult:
    return await run(explain(req))


@router.post("/quiz", response_model=QuizData, responses=ERRORS, summary="Quiz on a room")
async def quiz_route(req: QuizRequest) -> QuizData:
    return await run(make_quiz(req))
