from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
