from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.models import User

UNAUTHENTICATED_BODY = {
    "ok": False,
    "error": {"code": "UNAUTHENTICATED", "message": "Authentication is required."},
}


def seed_user_and_token(session: Session, sub: str) -> tuple[User, str]:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    return user, token


def test_me_returns_the_current_user(client: TestClient, db_session: Session) -> None:
    user, token = seed_user_and_token(db_session, "me-ok")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.get("/v1/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["email"] == user.email
    assert body["data"]["id"] == str(user.id)


def test_me_without_a_cookie_is_unauthenticated(client: TestClient) -> None:
    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_me_with_an_unknown_token_is_unauthenticated(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE, "not-a-real-token")

    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_me_with_an_expired_session_is_unauthenticated(
    client: TestClient, db_session: Session
) -> None:
    user = User(google_sub="me-expired", email="e@example.com")
    db_session.add(user)
    db_session.flush()
    token, row = create_session(db_session, user)
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()
    client.cookies.set(SESSION_COOKIE, token)

    response = client.get("/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == UNAUTHENTICATED_BODY


def test_a_token_never_resolves_to_a_different_user(
    client: TestClient, db_session: Session
) -> None:
    _, mine = seed_user_and_token(db_session, "iso-mine")
    other, _ = seed_user_and_token(db_session, "iso-other")
    client.cookies.set(SESSION_COOKIE, mine)

    response = client.get("/v1/auth/me")

    assert response.json()["data"]["email"] != other.email
