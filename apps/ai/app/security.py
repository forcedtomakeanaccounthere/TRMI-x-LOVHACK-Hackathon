import hmac

from fastapi import Header, HTTPException

from app.config import get_settings


def require_internal(x_internal_token: str = Header(default="")) -> None:
    """Only apps/backend may call the AI routes: anyone else would spend our provider quota."""
    expected = get_settings().ai_internal_token
    if not expected:
        return  # development without a token; production can't start without one (config.py)
    if not hmac.compare_digest(x_internal_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
