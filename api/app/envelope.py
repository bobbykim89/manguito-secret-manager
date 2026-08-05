import logging
import re
from http import HTTPStatus
from typing import Any, Literal

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

INTERNAL_ERROR_MESSAGE = "An unexpected error occurred."


class Ok[T](BaseModel):
    """Success arm of the ADR 002 response envelope."""

    ok: Literal[True] = True
    data: T


class ErrorBody(BaseModel):
    code: str
    message: str


class Err(BaseModel):
    """Failure arm of the ADR 002 response envelope."""

    ok: Literal[False] = False
    error: ErrorBody


class ApiError(Exception):
    """An application error that renders as the envelope's failure arm.

    Never put a secret value in `message`. ADR 002 requires that the error
    handler cannot serialise a secret into a response or a stack trace.
    """

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


# The phrase for these two reads poorly as a client-facing code, so they are
# spelled out rather than derived.
_CODE_OVERRIDES = {422: "VALIDATION_ERROR", 500: "INTERNAL_ERROR"}


def code_for_status(status_code: int) -> str:
    """Stable machine-readable code for a status the application did not raise itself.

    Clients branch on `error.code`, so it has to stay the same across FastAPI
    versions that reword the human-readable detail.
    """
    override = _CODE_OVERRIDES.get(status_code)
    if override is not None:
        return override
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        return "HTTP_ERROR"
    return re.sub(r"[^A-Z0-9]+", "_", phrase.upper()).strip("_")


def _error_response(status_code: int, code: str, message: str, **kwargs: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=Err(error=ErrorBody(code=code, message=message)).model_dump(),
        **kwargs,
    )


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return _error_response(exc.status_code, exc.code, exc.message)


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render FastAPI's own 404, 405 and friends as the envelope."""
    assert isinstance(exc, StarletteHTTPException)
    message = str(exc.detail) if exc.detail else HTTPStatus(exc.status_code).phrase
    # 405 carries Allow and 401 carries WWW-Authenticate; dropping them would
    # make the response non-conformant.
    return _error_response(
        exc.status_code, code_for_status(exc.status_code), message, headers=exc.headers
    )


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render a request that failed Pydantic validation as the envelope.

    Only the field locations are reported. Pydantic's error entries carry the
    rejected input, which from SP3 onward can be a plaintext secret, and
    CLAUDE.md invariant 1 forbids that reaching a response body.
    """
    assert isinstance(exc, RequestValidationError)
    fields = ", ".join(".".join(str(part) for part in error["loc"]) for error in exc.errors())
    message = (
        f"Request validation failed for: {fields}." if fields else "Request validation failed."
    )
    return _error_response(422, code_for_status(422), message)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render anything unanticipated as a 500 envelope with no internal detail.

    The message is fixed. `str(exc)` and traceback text can hold row contents,
    connection strings or a plaintext secret, none of which may cross the
    response boundary (CLAUDE.md invariant 1). The real exception goes to the
    server log instead.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return _error_response(500, code_for_status(500), INTERNAL_ERROR_MESSAGE)
