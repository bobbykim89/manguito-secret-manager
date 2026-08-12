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
from app.routers import api_keys, auth, buckets, health, secrets
from app.security_headers import SecurityHeadersMiddleware


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="manguito-secret-manager API", version="0.1.0")

    # allow_credentials=True does not make Starlette reject a wildcard
    # origin; it makes Starlette reflect whatever Origin the request sent
    # instead of literally sending "*". CORS_ORIGINS="*" would therefore
    # grant every site on the internet a credentialed origin, which is why
    # cors_origin_list refuses to produce one.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # After CORS, so this file reads as "who may call this", then "what the
    # browser does with what comes back". The two set disjoint header names,
    # so the order does not matter functionally.
    application.add_middleware(SecurityHeadersMiddleware, settings=settings)
    # Every error path renders the ADR 002 envelope, not just the ones the
    # application raises. A client that has to parse two shapes loses the
    # error code on exactly the failures it most needs to report.
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_error_handler)
    application.add_exception_handler(Exception, unhandled_exception_handler)
    application.include_router(health.router)
    application.include_router(auth.router)
    application.include_router(buckets.router)
    application.include_router(secrets.router)
    application.include_router(api_keys.router)
    return application


app = create_app()
