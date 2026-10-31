import logging
from contextvars import ContextVar

# Set per request from the X-Request-Id header apps/backend sends, so both services' logs line up.
request_id: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        return True
