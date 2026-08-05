from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import create_db_engine, get_db
from app.main import app


@pytest.fixture
def client(postgres_url: str) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_health_returns_ok_envelope(client: TestClient) -> None:
    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"db": "ok"}}


def test_health_returns_503_when_the_database_is_unreachable(client: TestClient) -> None:
    unreachable = create_db_engine("postgresql+psycopg://nobody:nobody@127.0.0.1:1/none")

    def broken_db() -> Iterator[Session]:
        with Session(unreachable) as session:
            yield session

    app.dependency_overrides[get_db] = broken_db
    try:
        response = client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "error": {"code": "DB_UNAVAILABLE", "message": "Database is not reachable."},
    }


def test_cors_allows_the_configured_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_rejects_an_unlisted_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert "access-control-allow-origin" not in response.headers
