from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session, hash_token
from app.models import User, UserSession


def seed(session: Session, sub: str) -> str:
    user = User(google_sub=sub, email=f"{sub}@example.com")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    return token


def test_logout_deletes_the_session_row(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-1")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.post("/v1/auth/logout")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"signed_out": True}}
    assert (
        db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(token))
        ).scalar_one_or_none()
        is None
    )


def test_logout_clears_the_cookie(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-2")
    client.cookies.set(SESSION_COOKIE, token)

    response = client.post("/v1/auth/logout")

    headers = response.headers.get_list("set-cookie")
    assert any(SESSION_COOKIE in header and "Max-Age=0" in header for header in headers)


def test_logout_without_a_session_still_succeeds(client: TestClient) -> None:
    response = client.post("/v1/auth/logout")

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_logout_twice_still_succeeds(client: TestClient, db_session: Session) -> None:
    token = seed(db_session, "logout-3")
    client.cookies.set(SESSION_COOKIE, token)

    client.post("/v1/auth/logout")
    client.cookies.set(SESSION_COOKIE, token)
    second = client.post("/v1/auth/logout")

    assert second.status_code == 200
    assert second.json()["ok"] is True


def test_logout_leaves_other_sessions_alone(client: TestClient, db_session: Session) -> None:
    mine = seed(db_session, "logout-mine")
    theirs = seed(db_session, "logout-theirs")
    client.cookies.set(SESSION_COOKIE, mine)

    client.post("/v1/auth/logout")

    assert (
        db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(theirs))
        ).scalar_one_or_none()
        is not None
    )
