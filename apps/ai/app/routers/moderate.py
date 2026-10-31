from fastapi import APIRouter

from app.schemas import ModerateRequest, ModerateResponse
from app.services.moderation import flagged_categories

router = APIRouter()


@router.post(
    "/moderate",
    response_model=ModerateResponse,
    summary="Check text shown to a whole room against the blocking moderation categories",
)
async def moderate(req: ModerateRequest) -> ModerateResponse:
    # Fails open: empty when moderation is off, has no key, or is unavailable.
    return ModerateResponse(flagged=await flagged_categories(req.text))
