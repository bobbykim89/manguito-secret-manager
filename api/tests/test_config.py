import pytest

from app.config import Settings


def test_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("ENVIRONMENT", "production")

    settings = Settings()

    assert settings.database_url == "postgresql+psycopg://u:p@localhost:5433/db"
    assert settings.environment == "production"


def test_cors_origin_list_splits_and_strips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example.com , https://b.example.com ")

    assert Settings().cors_origin_list == [
        "https://a.example.com",
        "https://b.example.com",
    ]


def test_cors_origin_list_is_empty_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", "")

    assert Settings().cors_origin_list == []


def test_google_settings_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://api.example.com/v1/auth/google/callback")
    monkeypatch.setenv("APP_URL", "https://app.example.com")

    settings = Settings()

    assert settings.google_client_id == "client-id"
    assert settings.google_client_secret == "client-secret"
    assert settings.google_redirect_uri == "https://api.example.com/v1/auth/google/callback"
    assert settings.app_url == "https://app.example.com"


def test_session_cookie_domain_defaults_to_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://api.example.com/cb")
    monkeypatch.setenv("APP_URL", "https://app.example.com")

    assert Settings().session_cookie_domain == ""


def test_is_production_follows_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://api.example.com/cb")
    monkeypatch.setenv("APP_URL", "https://app.example.com")

    monkeypatch.setenv("ENVIRONMENT", "production")
    assert Settings().is_production is True

    monkeypatch.setenv("ENVIRONMENT", "local")
    assert Settings().is_production is False
