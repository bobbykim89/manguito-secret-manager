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
