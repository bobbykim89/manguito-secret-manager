import base64

import pytest
from pydantic import ValidationError

from app.config import ConfigurationError, Settings, get_settings


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


def test_app_url_trailing_slash_is_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    # APP_URL="http://testserver/" must not become "http://testserver//login"
    # once a redirect target appends "/login": "//login" is a real path, not
    # protocol-relative, and no router matches it.
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5433/db")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "https://api.example.com/cb")
    monkeypatch.setenv("APP_URL", "http://testserver/")

    assert Settings().app_url == "http://testserver"


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


KEK_A = base64.b64encode(bytes(range(32))).decode()
KEK_B = base64.b64encode(bytes(range(32, 64))).decode()

_REQUIRED: dict[str, object] = {
    "database_url": "postgresql+psycopg://x/x",
    "google_client_id": "id",
    "google_client_secret": "secret",
    "google_redirect_uri": "http://testserver/cb",
    "app_url": "http://testserver",
}


def build_settings(**overrides: object) -> Settings:
    """Settings built from explicit values only.

    _env_file=None stops pydantic-settings reading the repository's real
    .env, which would otherwise make these assertions depend on the
    developer's local configuration.
    """
    values = {**_REQUIRED, "secrets_keks": f"1:{KEK_A}", "secrets_kek_version": 1, **overrides}
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


def test_kek_map_parses_multiple_versions() -> None:
    settings = build_settings(secrets_keks=f"1:{KEK_A},2:{KEK_B}", secrets_kek_version=2)

    assert set(settings.kek_map) == {1, 2}
    assert len(settings.kek_map[1]) == 32


def test_a_current_version_that_is_not_configured_fails() -> None:
    with pytest.raises(ValidationError):
        build_settings(secrets_keks=f"1:{KEK_A}", secrets_kek_version=9)


def test_a_kek_of_the_wrong_length_fails() -> None:
    short = base64.b64encode(b"too short").decode()

    with pytest.raises(ValidationError):
        build_settings(secrets_keks=f"1:{short}")


def test_malformed_base64_fails() -> None:
    with pytest.raises(ValidationError):
        build_settings(secrets_keks="1:not-valid-base64!!")


def test_a_missing_version_prefix_fails() -> None:
    with pytest.raises(ValidationError):
        build_settings(secrets_keks=KEK_A)


def test_an_empty_kek_list_fails() -> None:
    with pytest.raises(ValidationError):
        build_settings(secrets_keks="")


def test_a_duplicate_version_fails() -> None:
    with pytest.raises(ValidationError):
        build_settings(secrets_keks=f"1:{KEK_A},1:{KEK_B}")


def test_a_rejected_kek_never_appears_in_the_error() -> None:
    """Invariant 1 applied to configuration.

    A wrong length KEK is still real key material, and a ValidationError
    string lands in logs and in crash reports.
    """
    short = base64.b64encode(bytes(range(31))).decode()

    with pytest.raises(ValidationError) as raised:
        build_settings(secrets_keks=f"1:{short}")

    assert short not in str(raised.value)


def test_secrets_keks_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRETS_KEKS", raising=False)
    monkeypatch.delenv("SECRETS_KEK_VERSION", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **_REQUIRED)  # type: ignore[arg-type]


def test_get_settings_does_not_leak_the_kek_in_a_structured_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The surface str() missed.

    A pydantic ValidationError carries the raw input it rejected in
    .errors() and .json(). For SECRETS_KEKS that input is the KEK. str()
    happened not to show it, but only because pydantic truncates its dict
    repr at a fixed width and this field sits late in the declaration
    order, which is luck rather than a guarantee.
    """
    leaked = base64.b64encode(bytes(range(31))).decode()
    monkeypatch.setenv("SECRETS_KEKS", f"1:{leaked}")
    get_settings.cache_clear()

    try:
        with pytest.raises(ConfigurationError) as raised:
            get_settings()
    finally:
        get_settings.cache_clear()

    assert leaked not in str(raised.value)
    assert leaked not in repr(raised.value)
    assert not hasattr(raised.value, "errors")
    # from None rather than from error: a chained ValidationError would
    # still carry the KEK, reachable and printed in the traceback.
    assert raised.value.__cause__ is None
