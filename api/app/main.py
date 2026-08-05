from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.envelope import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_error_handler,
)
from app.routers import health


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="manguito-secret-manager API", version="0.1.0")

    # allow_credentials with a wildcard origin is rejected by browsers, and
    # SP2's session cookie depends on credentialed requests working.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Every error path renders the ADR 002 envelope, not just the ones the
    # application raises. A client that has to parse two shapes loses the
    # error code on exactly the failures it most needs to report.
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.add_exception_handler(Exception, unhandled_exception_handler)
    application.include_router(health.router)
    return application


app = create_app()
