from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


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


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return JSONResponse(
        status_code=exc.status_code,
        content=Err(error=ErrorBody(code=exc.code, message=exc.message)).model_dump(),
    )
