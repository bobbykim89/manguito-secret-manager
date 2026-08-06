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


def test_cors_origin_list_rejects_a_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    # allow_credentials=True means Starlette reflects the requesting Origin
    # rather than sending a literal "*", so a wildcard here would silently
    # grant every site on the internet a credentialed origin.
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com,*")

    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        _ = Settings().cors_origin_list


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


def test_session_cookie_domain_defaults_to_empty() -> None:
    # _env_file=None disables the dotenv source so this exercises the class
    # default rather than whatever SESSION_COOKIE_DOMAIN happens to be in the
    # developer's local .env (pydantic-settings precedence is env > dotenv >
    # field default, and .env is real once Task 4 starts touching cookies).
    settings = Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        google_client_id="client-id",
        google_client_secret="client-secret",
        google_redirect_uri="https://api.example.com/cb",
        app_url="https://app.example.com",
    )

    assert settings.session_cookie_domain == ""


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

    monkeypatch.setenv("ENVIRONMENT", "test")
    assert Settings().is_production is False

    monkeypatch.setenv("ENVIRONMENT", "schema-dump")
    assert Settings().is_production is False

    # Fails closed: an unrecognised value, including a differently-cased
    # known one, is treated as production rather than silently trusted.
    monkeypatch.setenv("ENVIRONMENT", "Production")
    assert Settings().is_production is True

    monkeypatch.setenv("ENVIRONMENT", "staging")
    assert Settings().is_production is True
