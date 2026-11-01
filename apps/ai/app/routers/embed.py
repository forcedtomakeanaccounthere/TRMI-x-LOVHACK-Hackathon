from fastapi import APIRouter, HTTPException

from app.schemas import EmbedRequest, EmbedResponse, ErrorResponse
from app.services.embeddings import EmbeddingError, NoEmbeddingProviderError, embed

router = APIRouter()


@router.post(
    "/embed",
    response_model=EmbedResponse,
    summary="Embed passages (for indexing) or a question (for search)",
    responses={
        502: {"model": ErrorResponse, "description": "The embedding provider failed"},
        503: {"model": ErrorResponse, "description": "The embedding provider has no API key"},
    },
)
async def embed_texts(req: EmbedRequest) -> EmbedResponse:
    try:
        model, vectors = await embed(req.texts, req.input_type, req.model)
    except NoEmbeddingProviderError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except EmbeddingError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return EmbedResponse(model=model, vectors=vectors)
