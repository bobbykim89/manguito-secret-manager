import uuid

import pytest
from fastapi import Response
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.caller import Caller
from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.buckets import create_bucket
from app.crypto.keys import EnvKeyProvider
from app.envelope import ApiError
from app.models import AuditEntry, User
from app.routers.secrets import list_endpoint
from app.secrets_service import put_secret


def sign_in(client: TestClient, session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return user


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def setup(
    client: TestClient, session: Session, sub: str, bucket: str, *, can_reveal: bool
) -> tuple[User, str]:
    user = sign_in(client, session, sub)
    client.post("/v1/buckets", json={"name": bucket})
    client.put(f"/v1/buckets/{bucket}/secrets/ALPHA", json={"value": "alpha-value"})
    client.put(f"/v1/buckets/{bucket}/secrets/BETA", json={"value": "beta-value"})
    token = client.post(
        "/v1/keys",
        json={"name": "ci", "buckets": [bucket], "can_write": False, "can_reveal": can_reveal},
    ).json()["data"]["token"]
    client.cookies.clear()
    return user, token


def test_reveal_returns_every_value_as_a_mapping(client: TestClient, db_session: Session) -> None:
    """The shape a CI consumer wants, and one the unrevealed list cannot be
    mistaken for."""
    setup(client, db_session, "reveal-ok", "revealing", can_reveal=True)
    _, token = setup(client, db_session, "reveal-ok2", "revealing2", can_reveal=True)

    response = client.get("/v1/buckets/revealing2/secrets?reveal=true", headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["data"] == {"ALPHA": "alpha-value", "BETA": "beta-value"}


def test_reveal_is_not_cacheable(client: TestClient, db_session: Session) -> None:
    """It carries every plaintext in the bucket."""
    _, token = setup(client, db_session, "reveal-nostore", "revealnostore", can_reveal=True)

    response = client.get("/v1/buckets/revealnostore/secrets?reveal=true", headers=bearer(token))

    assert response.headers["Cache-Control"] == "no-store"


def test_without_reveal_the_same_endpoint_returns_metadata(
    client: TestClient, db_session: Session
) -> None:
    _, token = setup(client, db_session, "reveal-off", "revealoff", can_reveal=True)

    response = client.get("/v1/buckets/revealoff/secrets", headers=bearer(token))

    data = response.json()["data"]
    assert isinstance(data, list)
    assert set(data[0]) == {"key_name", "created_at", "updated_at"}
    assert "alpha-value" not in response.text


def test_a_key_without_the_scope_is_refused(client: TestClient, db_session: Session) -> None:
    _, token = setup(client, db_session, "reveal-noscope", "revealnoscope", can_reveal=False)

    response = client.get("/v1/buckets/revealnoscope/secrets?reveal=true", headers=bearer(token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "REVEAL_NOT_PERMITTED"
    assert "alpha-value" not in response.text


def test_a_denied_reveal_is_audited(client: TestClient, db_session: Session) -> None:
    """The entry SP4 deferred. It records a credential that asked and was
    refused, which is worth having only now that refusal discriminates."""
    user, token = setup(client, db_session, "reveal-denied", "revealdenied", can_reveal=False)

    client.get("/v1/buckets/revealdenied/secrets?reveal=true", headers=bearer(token))

    entry = db_session.scalars(
        select(AuditEntry)
        .where(AuditEntry.user_id == user.id, AuditEntry.action == "reveal.denied")
        .order_by(AuditEntry.created_at.desc())
    ).first()
    assert entry is not None
    assert entry.bucket_name == "revealdenied"
    assert entry.api_key_id is not None


def test_a_successful_reveal_audits_one_row_per_secret(
    client: TestClient, db_session: Session
) -> None:
    """One row saying a reveal happened would not let you reconstruct which
    secrets left the building."""
    user, token = setup(client, db_session, "reveal-audit", "revealaudit", can_reveal=True)

    client.get("/v1/buckets/revealaudit/secrets?reveal=true", headers=bearer(token))

    entries = list(
        db_session.scalars(
            select(AuditEntry).where(
                AuditEntry.user_id == user.id, AuditEntry.action == "secret.read"
            )
        )
    )
    assert {entry.key_name for entry in entries} == {"ALPHA", "BETA"}
    assert all(entry.api_key_id is not None for entry in entries)


def test_an_empty_bucket_reveals_an_empty_mapping(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "reveal-empty")
    client.post("/v1/buckets", json={"name": "revealempty"})
    token = client.post(
        "/v1/keys",
        json={
            "name": "ci",
            "buckets": ["revealempty"],
            "can_write": False,
            "can_reveal": True,
        },
    ).json()["data"]["token"]
    client.cookies.clear()

    response = client.get("/v1/buckets/revealempty/secrets?reveal=true", headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["data"] == {}


def test_reveal_on_an_out_of_scope_bucket_is_refused_before_the_lookup(
    client: TestClient, db_session: Session
) -> None:
    """Reveal is a property of the credential, so it is decided without
    consulting a bucket the caller may have no business knowing about."""
    _, token = setup(client, db_session, "reveal-order", "revealorder", can_reveal=False)

    response = client.get("/v1/buckets/nosuchbucket/secrets?reveal=true", headers=bearer(token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "REVEAL_NOT_PERMITTED"


def test_the_body_refuses_reveal_even_without_the_route_dependency(
    db_session: Session,
) -> None:
    """The gate must not depend solely on a decorator argument.

    A monkeypatch on `app.routers.secrets.deny_reveal` was tried first, to
    simulate someone removing the route level dependency in a refactor. It
    does not reach the endpoint under test: FastAPI resolves a route's
    dependency callables once, at route registration, so patching the
    module attribute afterward never touches the wiring an HTTP request
    goes through, and the test passed even with the body check removed.

    Calling list_endpoint directly is what actually bypasses deny_reveal,
    proving the body's own check is what refuses this caller.
    """
    provider = EnvKeyProvider({1: bytes(range(32))}, 1)
    user = User(google_sub="reveal-belt-direct", email="reveal-belt-direct@example.com", name="T")
    db_session.add(user)
    db_session.flush()
    bucket = create_bucket(db_session, provider, user, "revealbeltdirect")
    put_secret(db_session, provider, bucket, "ALPHA", "alpha-value")
    db_session.commit()
    caller = Caller(
        user=user,
        api_key_id=uuid.uuid4(),
        can_write=False,
        can_reveal=False,
        scoped_bucket_ids=frozenset({bucket.id}),
    )

    with pytest.raises(ApiError) as excinfo:
        list_endpoint(
            bucket=bucket,
            caller=caller,
            session=db_session,
            provider=provider,
            response=Response(),
            reveal=True,
        )

    assert excinfo.value.status_code == 403
    assert excinfo.value.code == "REVEAL_NOT_PERMITTED"
