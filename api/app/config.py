from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that are definitely not production. Anything else, including a
# typo or a new environment name, is treated as production, because a
# wrong guess here costs a broken local login you notice immediately
# rather than a missing Secure flag in production that nobody notices.
_NON_PRODUCTION = frozenset({"local", "test", "schema-dump"})


class Settings(BaseSettings):
    """Application configuration, read from the environment.

    SECRETS_KEK is deliberately absent until SP3. Nothing decrypts yet, and an
    unvalidated secret sitting in Fly that no code reads is a configuration
    error nobody would notice.
    """

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    cors_origins: str = ""
    environment: str = "local"
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    app_url: str
    session_cookie_domain: str = ""

    @field_validator("app_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        # Every redirect target is built as f"{app_url}/path", so a trailing
        # slash on app_url turns that into "//path": a real path, not
        # protocol-relative, that no router will match. Normalize once here
        # instead of at every call site.
        return value.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if "*" in origins:
            # CORSMiddleware runs with allow_credentials=True, and Starlette's
            # response to a wildcard origin under credentials is not to send
            # "*": it reflects whatever Origin the request sent. A wildcard
            # here would silently make every origin on the internet a
            # credentialed one.
            raise ValueError(
                "CORS_ORIGINS cannot contain '*': with allow_credentials=True, "
                "Starlette reflects any Origin instead of sending a literal "
                "wildcard, which would grant every site credentialed access"
            )
        return origins

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() not in _NON_PRODUCTION


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
