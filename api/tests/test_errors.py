from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.routing import BaseRoute

from app.db import get_db
from app.envelope import INTERNAL_ERROR_MESSAGE, code_for_status
from app.main import app

SECRET_LOOKING_DETAIL = "hunter2-should-never-reach-the-client"


@pytest.fixture
def client(postgres_url: str) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def unsafe_client(postgres_url: str) -> Iterator[TestClient]:
    """A client that returns the 500 instead of re-raising it.

    Starlette's ServerErrorMiddleware re-raises after the handler runs, so the
    default TestClient never lets the rendered body be inspected.
    """
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def echo_route() -> Iterator[None]:
    """A route with a required query parameter, so validation can be exercised.

    SP1 has no route that takes input, and the envelope has to cover 422 before
    SP2 adds one.
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


def test_code_for_status_is_stable_and_machine_readable() -> None:
    assert code_for_status(404) == "NOT_FOUND"
    assert code_for_status(405) == "METHOD_NOT_ALLOWED"
    assert code_for_status(422) == "VALIDATION_ERROR"
    assert code_for_status(500) == "INTERNAL_ERROR"
    assert code_for_status(599) == "HTTP_ERROR"


def test_unknown_path_returns_the_envelope(client: TestClient) -> None:
    response = client.get("/v1/nope")

    assert response.status_code == 404
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["message"]


def test_wrong_method_returns_the_envelope(client: TestClient) -> None:
    response = client.post("/v1/health")

    assert response.status_code == 405
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_invalid_request_returns_the_envelope(client: TestClient, echo_route: None) -> None:
    response = client.get("/v1/echo", params={"count": "not-a-number"})

    assert response.status_code == 422
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "count" in body["error"]["message"]
    assert "not-a-number" not in body["error"]["message"]


def test_unhandled_exception_returns_the_envelope(unsafe_client: TestClient) -> None:
    def exploding_db() -> Iterator[None]:
        raise RuntimeError(SECRET_LOOKING_DETAIL)
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": {"code": "INTERNAL_ERROR", "message": INTERNAL_ERROR_MESSAGE},
    }


def test_unhandled_exception_leaks_no_internal_detail(unsafe_client: TestClient) -> None:
    def exploding_db() -> Iterator[None]:
        raise RuntimeError(SECRET_LOOKING_DETAIL)
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert SECRET_LOOKING_DETAIL not in response.text
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text
