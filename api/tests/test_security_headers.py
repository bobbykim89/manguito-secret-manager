from collections.abc import Iterator

import pytest
from fastapi import Response
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from starlette.routing import BaseRoute

from app.config import Settings
from app.db import get_db
from app.main import app
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
    """Absent even though /docs and /redoc do render real HTML.

    CSP, X-Frame-Options and Permissions-Policy constrain how a browser
    renders a document. FastAPI's default /docs and /redoc serve real HTML
    and pull Swagger UI's assets from a CDN, so it isn't that nothing here
    renders HTML: a CSP strict enough to matter would need to accommodate
    that CDN dependency, which is more design work than this piece scoped.
    Their absence is pinned rather than left to drift in later.
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


@pytest.mark.parametrize(
    ("path", "expected_status"),
    [
        ("/v1/health", 200),
        ("/v1/buckets", 401),
        ("/v1/nosuchroute", 404),
    ],
)
def test_headers_are_on_every_ordinary_response(
    client: TestClient, path: str, expected_status: int
) -> None:
    """A 200, an authentication failure, and a route that does not exist.

    The 401 and 404 matter as much as the 200: they are rendered by exception
    handlers rather than by a route, and a middleware that only covered
    successful responses would still pass a test that checked one 200.
    """
    response = client.get(path)

    assert response.status_code == expected_status
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


@pytest.fixture
def echo_route() -> Iterator[None]:
    """A route with a required query parameter, so 422 can be reached.

    Copied from the fixture of the same name in test_errors.py, for the same
    reason it exists there. Every real route that validates a path parameter
    also requires a session, so an unauthenticated request to one returns 401
    from the auth dependency and never reaches validation_error_handler at
    all. A throwaway route with no auth is the only way to exercise the 422
    path without building a signed in session.
    """

    def echo(count: int) -> dict[str, int]:
        return {"count": count}

    before: list[BaseRoute] = list(app.router.routes)
    app.add_api_route("/v1/echo", echo, methods=["GET"])
    app.openapi_schema = None
    try:
        yield
    finally:
        app.router.routes[:] = before
        app.openapi_schema = None


def test_headers_are_on_a_validation_failure(client: TestClient, echo_route: None) -> None:
    # 422 comes from validation_error_handler, a fourth distinct path.
    response = client.get("/v1/echo?count=not-a-number")

    assert response.status_code == 422
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"


def test_hsts_is_absent_in_the_test_environment(client: TestClient) -> None:
    # conftest sets ENVIRONMENT=test, which is_production treats as
    # non-production. This pins that the gate is read at request time from
    # real settings rather than hardcoded on.
    response = client.get("/v1/health")

    assert HSTS_HEADER not in response.headers


def test_headers_are_on_an_unhandled_five_hundred(migrated_engine: Engine) -> None:
    """The one response that does not pass through the middleware.

    Starlette puts the Exception handler in ServerErrorMiddleware, outside
    every user middleware, so this is covered by envelope.py calling the same
    function rather than by SecurityHeadersMiddleware. Deleting that call
    makes this test, and only this test, fail.

    raise_server_exceptions=False so the rendered body comes back instead of
    the exception being re-raised into the test.
    """

    def exploding_db() -> Iterator[None]:
        raise RuntimeError("boom")
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        with TestClient(app, raise_server_exceptions=False) as unsafe_client:
            response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 500
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_the_five_hundred_still_leaks_nothing(migrated_engine: Engine) -> None:
    """Guards the edit in Task 3 against weakening invariant 1.

    envelope.py's 500 handler is being modified, and the property that matters
    most about it is that str(exc) never reaches the body.
    """

    def exploding_db() -> Iterator[None]:
        raise RuntimeError("hunter2-should-never-reach-the-client")
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        with TestClient(app, raise_server_exceptions=False) as unsafe_client:
            response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert "hunter2-should-never-reach-the-client" not in response.text
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text


def test_a_revealed_secret_is_still_not_cacheable(client: TestClient) -> None:
    """The response that used to set no-store by hand, at secrets.py.

    ADR 002 A21 records that GET on a secret is not safe in the HTTP sense,
    because it writes an audit row. This is what says so on the wire, and it
    has to keep saying it after the per route line is removed.

    A 401 exercises the same route without needing a session, a bucket, a
    secret and a KEK. The header comes from the middleware either way, which
    is exactly the property being pinned.
    """
    response = client.get("/v1/buckets/prod/secrets/DATABASE_URL")

    assert response.headers["Cache-Control"] == "no-store"


def test_the_key_creation_route_is_still_not_cacheable(client: TestClient) -> None:
    """The response that used to set no-store by hand, at api_keys.py.

    A 401 exercises the same route without needing a session, matching the
    pattern above. The real 201 carrying a live token is covered by
    test_api_keys_api.py; this test only needs to prove the header survives
    on this route, which the middleware does regardless of status code.
    """
    response = client.post("/v1/keys", json={"name": "n", "buckets": ["b"]})

    assert response.status_code == 401
    assert response.headers["Cache-Control"] == "no-store"


def test_headers_are_on_a_cors_preflight_response(client: TestClient) -> None:
    """CORSMiddleware short-circuits preflight OPTIONS without calling the
    inner app, so whichever of CORS and SecurityHeadersMiddleware is
    outermost decides whether a preflight response carries these headers.
    SecurityHeadersMiddleware is registered second in main.py, which
    Starlette's add_middleware makes outermost. This pins that the resulting
    order actually produces headers on preflight responses, rather than
    trusting the comment in main.py.
    """
    response = client.options(
        "/v1/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_no_store_overwrites_a_route_that_tries_to_set_its_own_cache_control() -> None:
    """Proves the invariant is enforced by construction, not by convention.

    apply_security_headers overwrites unconditionally rather than using
    setdefault. Nothing else in this suite would catch a regression from
    overwrite to setdefault, since no other test has a route that tries to
    set a conflicting Cache-Control.
    """

    def conflicting(response: Response) -> dict[str, bool]:
        response.headers["Cache-Control"] = "max-age=3600"
        return {"ok": True}

    before: list[BaseRoute] = list(app.router.routes)
    app.add_api_route("/v1/conflicting-cache-control", conflicting, methods=["GET"])
    app.openapi_schema = None
    try:
        with TestClient(app) as one_off_client:
            response = one_off_client.get("/v1/conflicting-cache-control")
    finally:
        app.router.routes[:] = before
        app.openapi_schema = None

    assert response.headers["Cache-Control"] == "no-store"
