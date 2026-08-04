from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.envelope import ApiError, api_error_handler
from app.routers import health


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="secretbox API", version="0.1.0")

    # allow_credentials with a wildcard origin is rejected by browsers, and
    # SP2's session cookie depends on credentialed requests working.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_exception_handler(ApiError, api_error_handler)
    application.include_router(health.router)
    return application


app = create_app()
