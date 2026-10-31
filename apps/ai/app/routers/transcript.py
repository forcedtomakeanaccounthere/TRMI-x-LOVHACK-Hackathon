from fastapi import APIRouter, HTTPException

from app.schemas import ErrorResponse, TranscriptRequest, TranscriptResponse
from app.services.transcript import (
    NoTranscript,
    TranscriptBlocked,
    TranscriptError,
    fetch_transcript,
)

router = APIRouter()


@router.post(
    "/transcript",
    response_model=TranscriptResponse,
    summary="Fetch a YouTube video's captions",
    responses={
        404: {"model": ErrorResponse, "description": "No captions, or the video can't be played"},
        403: {"model": ErrorResponse, "description": "YouTube blocked this server's request"},
        502: {"model": ErrorResponse, "description": "Fetching failed or timed out"},
    },
)
async def transcript(req: TranscriptRequest) -> TranscriptResponse:
    try:
        return await fetch_transcript(req.video_id, req.languages)
    except NoTranscript as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except TranscriptBlocked as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except TranscriptError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
