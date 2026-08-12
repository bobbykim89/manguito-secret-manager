from fastapi import Response

from app.config import Settings
from app.security_headers import (
    HSTS_HEADER,
    HSTS_VALUE,
    SECURITY_HEADERS,
    apply_security_headers,
)


def settings_for(environment: str) -> Settings:
    """Every field passed explicitly, and the dotenv source disabled.

    Mirrors the helper in test_auth_cookies.py, which exists for the same
    reason: Settings otherwise reads ../.env, so a developer with a different
    ENVIRONMENT set locally would see a different result than CI.

    SECRETS_KEKS and SECRETS_KEK_VERSION are not passed. conftest.py sets both
    in os.environ at import time, and Settings reads the process environment
    for anything not given here.
    """
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment=environment,
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
    )


def test_the_ungated_headers_are_set() -> None:
    response = Response()

    apply_security_headers(response, settings_for("local"))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_hsts_is_sent_in_production() -> None:
    response = Response()

    apply_security_headers(response, settings_for("production"))

    assert response.headers[HSTS_HEADER] == HSTS_VALUE


def test_hsts_is_absent_locally() -> None:
    # Same gate as the session cookie's Secure flag. A browser ignores HSTS
    # over plain http anyway, so this is about following one convention for
    # environment-dependent security settings rather than about risk.
    response = Response()

    apply_security_headers(response, settings_for("local"))

    assert HSTS_HEADER not in response.headers


def test_hsts_does_not_ask_for_preload() -> None:
    # preload is a one way door: the browser preload list is slow to leave
    # and impossible to leave quickly. The domain is not even purchased yet.
    assert "preload" not in HSTS_VALUE


def test_no_html_rendering_headers_are_set() -> None:
    """Nothing renders this API's responses as HTML.

    CSP, X-Frame-Options and Permissions-Policy constrain how a browser
    renders a document. Setting them here would be decoration a header
    scanner rewards rather than a control doing work, so their absence is
    pinned rather than left to drift in later.
    """
    response = Response()

    apply_security_headers(response, settings_for("production"))

    assert "Content-Security-Policy" not in response.headers
    assert "X-Frame-Options" not in response.headers
    assert "Permissions-Policy" not in response.headers


def test_the_ungated_set_is_exactly_three() -> None:
    assert set(SECURITY_HEADERS) == {
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Cache-Control",
    }
