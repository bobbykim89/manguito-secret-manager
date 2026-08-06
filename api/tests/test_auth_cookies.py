import pytest
from fastapi import Response

from app.auth.cookies import (
    OAUTH_COOKIE,
    SESSION_COOKIE,
    clear_oauth_cookie,
    clear_session_cookie,
    read_oauth_cookie,
    set_oauth_cookie,
    set_session_cookie,
)
from app.auth.sessions import SESSION_LIFETIME
from app.config import Settings


def settings_for(environment: str, domain: str = "") -> Settings:
    """Every field is passed explicitly, and the dotenv source is disabled.

    Settings otherwise reads ../.env, so a developer with SESSION_COOKIE_DOMAIN
    set locally would fail the "no Domain locally" assertion while CI passed.
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
        session_cookie_domain=domain,
    )


def header_for(response: Response, name: str) -> str:
    for key, value in response.raw_headers:
        if key.decode().lower() == "set-cookie" and value.decode().startswith(f"{name}="):
            return value.decode()
    raise AssertionError(f"no Set-Cookie for {name}")


def test_session_cookie_is_secure_in_production() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("production", ".example.com"))

    header = header_for(response, SESSION_COOKIE)
    assert "Secure" in header
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()
    assert "Domain=.example.com" in header


def test_session_cookie_is_not_secure_locally() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("local"))

    header = header_for(response, SESSION_COOKIE)
    assert "Secure" not in header
    assert "Domain=" not in header
    assert "HttpOnly" in header


def test_clearing_the_session_cookie_expires_it() -> None:
    response = Response()
    clear_session_cookie(response, settings_for("local"))

    header = header_for(response, SESSION_COOKIE)
    assert "Max-Age=0" in header or "expires=Thu, 01 Jan 1970" in header.lower()


def test_clearing_the_session_cookie_matches_the_production_attributes() -> None:
    settings = settings_for("production", ".example.com")
    set_response = Response()
    set_session_cookie(set_response, "tok", settings)
    clear_response = Response()
    clear_session_cookie(clear_response, settings)

    set_header = header_for(set_response, SESSION_COOKIE)
    clear_header = header_for(clear_response, SESSION_COOKIE)

    # A browser only deletes a cookie when domain and path match the original.
    assert "Domain=.example.com" in clear_header
    assert "Secure" in clear_header
    assert "Path=/" in clear_header
    assert "Max-Age=0" in clear_header
    for attribute in ("Domain=.example.com", "Secure", "Path=/"):
        assert attribute in set_header


def test_session_cookie_lifetime_follows_session_lifetime() -> None:
    response = Response()
    set_session_cookie(response, "tok", settings_for("local"))

    header = header_for(response, SESSION_COOKIE)

    # The literal matters. Asserting only against SESSION_LIFETIME would be
    # self-satisfying, because set_session_cookie derives the max age from the
    # same constant, so a changed value would move both sides together.
    assert "Max-Age=604800" in header
    assert f"Max-Age={int(SESSION_LIFETIME.total_seconds())}" in header


def test_oauth_cookie_round_trips_state_and_verifier() -> None:
    response = Response()
    set_oauth_cookie(response, "the-state", "the-verifier", settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    raw = header.split(";")[0].split("=", 1)[1]

    assert read_oauth_cookie(raw) == ("the-state", "the-verifier")


def test_oauth_cookie_is_scoped_and_short_lived() -> None:
    response = Response()
    set_oauth_cookie(response, "s", "v", settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    assert "Path=/v1/auth" in header
    assert "Max-Age=600" in header
    assert "HttpOnly" in header


@pytest.mark.parametrize("raw", [None, "", "no-separator", "a.b.c"])
def test_read_oauth_cookie_rejects_malformed_values(raw: str | None) -> None:
    assert read_oauth_cookie(raw) is None


def test_clearing_the_oauth_cookie_uses_the_same_path() -> None:
    response = Response()
    clear_oauth_cookie(response, settings_for("local"))

    header = header_for(response, OAUTH_COOKIE)
    assert "Path=/v1/auth" in header


def test_clearing_the_oauth_cookie_matches_the_production_attributes() -> None:
    settings = settings_for("production", ".example.com")
    clear_response = Response()
    clear_oauth_cookie(clear_response, settings)

    clear_header = header_for(clear_response, OAUTH_COOKIE)

    assert "Secure" in clear_header
    assert "Path=/v1/auth" in clear_header


def test_the_oauth_cookie_is_not_domain_scoped_even_in_production() -> None:
    # Unlike the session cookie, only the API host ever reads msm_oauth, so
    # it must not carry the PKCE verifier to the frontend host too. This is
    # a deliberate difference from the session cookie, not an oversight, so
    # it is asserted against both in the same test.
    settings = settings_for("production", ".example.com")
    oauth_response = Response()
    set_oauth_cookie(oauth_response, "s", "v", settings)
    session_response = Response()
    set_session_cookie(session_response, "tok", settings)

    assert "Domain=" not in header_for(oauth_response, OAUTH_COOKIE)
    assert "Domain=.example.com" in header_for(session_response, SESSION_COOKIE)
