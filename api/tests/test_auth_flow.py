import dataclasses
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import OAUTH_COOKIE, SESSION_COOKIE
from app.auth.google import GoogleAuthError, GoogleIdentity, get_google_client
from app.main import app
from app.models import User, UserSession


class FakeGoogleClient:
    def __init__(self, identity: GoogleIdentity | None = None, error: Exception | None = None):
        self.identity = identity
        self.error = error

    def authorization_url(self, state: str, code_challenge: str) -> str:
        return f"https://accounts.google.test/auth?state={state}&code_challenge={code_challenge}"

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity:
        if self.error is not None:
            raise self.error
        assert self.identity is not None
        return self.identity


VERIFIED = GoogleIdentity(
    sub="google-sub-1", email="user@example.com", email_verified=True, name="User One"
)


@pytest.fixture
def fake_google() -> Iterator[FakeGoogleClient]:
    fake = FakeGoogleClient(identity=VERIFIED)
    app.dependency_overrides[get_google_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_google_client, None)


def start_flow(client: TestClient) -> tuple[str, str]:
    """Run /start and return the state and the raw oauth cookie."""
    response = client.get("/v1/auth/google/start", follow_redirects=False)
    assert response.status_code == 307
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    return state, client.cookies[OAUTH_COOKIE]


def error_code(response: Any) -> str:
    """The response type comes from httpx2 via TestClient, so it is left loose."""
    return str(parse_qs(urlparse(response.headers["location"]).query)["error"][0])


def test_start_redirects_to_google_and_sets_the_oauth_cookie(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get("/v1/auth/google/start", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"].startswith("https://accounts.google.test/auth")
    assert OAUTH_COOKIE in response.cookies


def test_start_uses_a_fresh_state_each_time(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    first, _ = start_flow(client)
    second, _ = start_flow(client)

    assert first != second


def test_callback_creates_a_user_and_a_session(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    identity = dataclasses.replace(VERIFIED, sub=f"google-sub-{uuid4()}")
    fake_google.identity = identity
    state, _ = start_flow(client)

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert response.status_code == 307
    assert "error=" not in response.headers["location"]
    assert SESSION_COOKIE in response.cookies

    user = db_session.execute(select(User).where(User.google_sub == identity.sub)).scalar_one()
    assert user.email == identity.email
    sessions = (
        db_session.execute(select(UserSession).where(UserSession.user_id == user.id))
        .scalars()
        .all()
    )
    assert len(sessions) == 1

    me = client.get("/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["email"] == identity.email


def test_second_login_reuses_the_user_and_refreshes_a_changed_email(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    sub = f"google-sub-{uuid4()}"
    fake_google.identity = dataclasses.replace(VERIFIED, sub=sub)
    state, _ = start_flow(client)
    client.get(f"/v1/auth/google/callback?code=a&state={state}", follow_redirects=False)

    fake_google.identity = GoogleIdentity(
        sub=sub, email="renamed@example.com", email_verified=True, name="Renamed"
    )
    state, _ = start_flow(client)
    client.get(f"/v1/auth/google/callback?code=b&state={state}", follow_redirects=False)

    users = db_session.execute(select(User).where(User.google_sub == sub)).scalars().all()
    assert len(users) == 1
    db_session.refresh(users[0])
    assert users[0].email == "renamed@example.com"


def test_denied_consent_redirects_with_its_code(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get("/v1/auth/google/callback?error=access_denied", follow_redirects=False)

    assert error_code(response) == "CONSENT_DENIED"


def test_missing_state_cookie_is_invalid_state(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    response = client.get(
        "/v1/auth/google/callback?code=abc&state=anything", follow_redirects=False
    )

    assert error_code(response) == "INVALID_STATE"


def test_mismatched_state_is_invalid_state(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    start_flow(client)

    response = client.get(
        "/v1/auth/google/callback?code=abc&state=not-the-one", follow_redirects=False
    )

    assert error_code(response) == "INVALID_STATE"


def test_non_ascii_state_is_invalid_state(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    start_flow(client)

    response = client.get(
        "/v1/auth/google/callback?code=abc&state=caf%C3%A9", follow_redirects=False
    )

    assert error_code(response) == "INVALID_STATE"


def test_missing_code_redirects_with_its_code(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    state, _ = start_flow(client)

    response = client.get(f"/v1/auth/google/callback?state={state}", follow_redirects=False)

    assert error_code(response) == "EXCHANGE_FAILED"


def test_exchange_failure_redirects_with_its_code(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    state, _ = start_flow(client)
    fake_google.error = GoogleAuthError("boom")

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert error_code(response) == "EXCHANGE_FAILED"


def test_an_unexpected_exchange_error_redirects_with_exchange_failed_and_clears_the_cookie(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    # Reproduces the reviewer's finding: a client raising something other
    # than GoogleAuthError (a malformed JSON body, a broken key set) must not
    # escape as a 500 with the OAuth cookie still set.
    state, _ = start_flow(client)
    fake_google.error = ValueError("not the exception type this route expects")

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert error_code(response) == "EXCHANGE_FAILED"
    cleared = response.headers.get_list("set-cookie")
    assert any(OAUTH_COOKIE in header and "Max-Age=0" in header for header in cleared)


def test_unverified_email_is_rejected(
    client: TestClient, fake_google: FakeGoogleClient, db_session: Session
) -> None:
    state, _ = start_flow(client)
    fake_google.identity = GoogleIdentity(
        sub="unverified-sub", email="nope@example.com", email_verified=False, name=None
    )

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    assert error_code(response) == "EMAIL_NOT_VERIFIED"
    assert (
        db_session.execute(
            select(User).where(User.google_sub == "unverified-sub")
        ).scalar_one_or_none()
        is None
    )


@pytest.mark.parametrize(
    "query",
    [
        "error=access_denied",
        "code=abc&state=wrong",
    ],
)
def test_the_oauth_cookie_is_cleared_on_failure(
    client: TestClient, fake_google: FakeGoogleClient, query: str
) -> None:
    start_flow(client)

    response = client.get(f"/v1/auth/google/callback?{query}", follow_redirects=False)

    cleared = response.headers.get_list("set-cookie")
    assert any(OAUTH_COOKIE in header and "Max-Age=0" in header for header in cleared)


def test_the_oauth_cookie_is_cleared_on_success(
    client: TestClient, fake_google: FakeGoogleClient
) -> None:
    state, _ = start_flow(client)

    response = client.get(
        f"/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False
    )

    cleared = response.headers.get_list("set-cookie")
    assert any(OAUTH_COOKIE in header and "Max-Age=0" in header for header in cleared)
