import base64
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.buckets import unwrap_dek
from app.crypto.keys import DEK_BYTES, get_key_provider
from app.models import AuditEntry, Bucket, User


def sign_in(client: TestClient, session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return user


def test_create_returns_the_bucket(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "api-create")

    response = client.post("/v1/buckets", json={"name": "prod"})

    assert response.status_code == 201
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["name"] == "prod"
    assert "id" in body["data"] and "created_at" in body["data"]


def test_create_stores_a_recoverable_dek(client: TestClient, db_session: Session) -> None:
    user = sign_in(client, db_session, "api-dek")

    client.post("/v1/buckets", json={"name": "recoverable"})

    bucket = db_session.scalars(
        select(Bucket).where(Bucket.user_id == user.id, Bucket.name == "recoverable")
    ).one()
    assert len(unwrap_dek(get_key_provider(), bucket)) == DEK_BYTES


def test_create_never_returns_key_material(client: TestClient, db_session: Session) -> None:
    """The KEK never leaves the server, and neither does a wrapped DEK."""
    sign_in(client, db_session, "api-no-keys")

    body = client.post("/v1/buckets", json={"name": "opaque"}).json()

    assert set(body["data"]) == {"id", "name", "created_at"}


def test_a_duplicate_name_conflicts(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "api-dupe")
    client.post("/v1/buckets", json={"name": "twice"})

    response = client.post("/v1/buckets", json={"name": "twice"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BUCKET_EXISTS"


def test_two_users_can_each_own_the_same_name(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "api-share-a")
    assert client.post("/v1/buckets", json={"name": "prod"}).status_code == 201

    sign_in(client, db_session, "api-share-b")

    assert client.post("/v1/buckets", json={"name": "prod"}).status_code == 201


def test_list_returns_only_your_own(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "api-list-theirs")
    client.post("/v1/buckets", json={"name": "theirs"})
    sign_in(client, db_session, "api-list-mine")
    client.post("/v1/buckets", json={"name": "mine"})

    body = client.get("/v1/buckets").json()

    assert [item["name"] for item in body["data"]] == ["mine"]


def test_delete_removes_the_bucket(client: TestClient, db_session: Session) -> None:
    sign_in(client, db_session, "api-delete")
    client.post("/v1/buckets", json={"name": "gone"})

    response = client.delete("/v1/buckets/gone")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"deleted": True}}
    assert client.get("/v1/buckets").json()["data"] == []


def test_deleting_another_users_bucket_is_a_404(client: TestClient, db_session: Session) -> None:
    """Not a 403. A 403 would confirm the name exists. See ADR 002's test plan."""
    sign_in(client, db_session, "api-cross-theirs")
    client.post("/v1/buckets", json={"name": "private"})
    sign_in(client, db_session, "api-cross-mine")

    response = client.delete("/v1/buckets/private")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "BUCKET_NOT_FOUND"


def test_deleting_a_bucket_that_never_existed_is_the_same_404(
    client: TestClient, db_session: Session
) -> None:
    sign_in(client, db_session, "api-absent")

    response = client.delete("/v1/buckets/never-existed")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "BUCKET_NOT_FOUND"


@pytest.mark.parametrize(
    "name",
    ["Prod", "with space", "with/slash", "-leading", "", "x" * 64, "with.dot", "_leading"],
)
def test_invalid_names_are_rejected(client: TestClient, db_session: Session, name: str) -> None:
    sign_in(client, db_session, f"api-name-{abs(hash(name))}")

    response = client.post("/v1/buckets", json={"name": name})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("name", ["prod", "a", "blog-prod", "manguito_staging", "x" * 63])
def test_valid_names_are_accepted(client: TestClient, db_session: Session, name: str) -> None:
    sign_in(client, db_session, f"api-ok-{abs(hash(name))}")

    assert client.post("/v1/buckets", json={"name": name}).status_code == 201


@pytest.mark.parametrize("name", ["Prod", "with space", "-leading", "x" * 64])
def test_deleting_an_invalid_name_is_rejected(
    client: TestClient, db_session: Session, name: str
) -> None:
    """A name that cannot exist is refused rather than reflected.

    Rejecting it discloses nothing a 404 did not, since the caller can tell
    the name is malformed without asking the server.
    """
    sign_in(client, db_session, f"api-del-invalid-{name.strip().replace(' ', '-')[:20]}")

    response = client.delete(f"/v1/buckets/{name}")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_an_unrelated_integrity_error_is_not_reported_as_a_duplicate(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only the name constraint means BUCKET_EXISTS.

    Anything else reaching this handler is a different failure, and calling
    it a duplicate name would send the caller after the wrong problem.
    """
    from app.main import app

    def explode(*args: object, **kwargs: object) -> None:
        raise IntegrityError("INSERT ...", {}, Exception("some other violation"))

    with TestClient(app, raise_server_exceptions=False) as failing_client:
        sign_in(failing_client, db_session, "api-other-integrity")
        monkeypatch.setattr("app.routers.buckets.create_bucket", explode)

        response = failing_client.post("/v1/buckets", json={"name": "unrelated"})

    assert response.status_code == 500
    assert response.json()["error"]["code"] != "BUCKET_EXISTS"


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/v1/buckets"), ("POST", "/v1/buckets"), ("DELETE", "/v1/buckets/anything")],
)
def test_every_endpoint_requires_a_session(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={"name": "prod"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_create_and_delete_are_both_audited(client: TestClient, db_session: Session) -> None:
    user = sign_in(client, db_session, "api-audit")
    client.post("/v1/buckets", json={"name": "watched"})
    client.delete("/v1/buckets/watched")

    entries = list(
        db_session.scalars(
            select(AuditEntry).where(AuditEntry.user_id == user.id).order_by(AuditEntry.created_at)
        )
    )
    assert [entry.action for entry in entries] == ["bucket.created", "bucket.deleted"]
    assert {entry.bucket_name for entry in entries} == {"watched"}


def test_a_duplicate_create_never_reaches_the_audit_writer(
    client: TestClient, db_session: Session
) -> None:
    """A create rejected by the unique constraint writes no audit entry.

    Narrower than it looks: create_bucket flushes and raises before the
    endpoint reaches record_audit, so this pins the ordering rather than
    the rollback. test_an_action_rolls_back_when_its_audit_entry_fails is
    what covers atomicity.
    """
    user = sign_in(client, db_session, "api-audit-rollback")
    client.post("/v1/buckets", json={"name": "once"})

    client.post("/v1/buckets", json={"name": "once"})

    entries = list(db_session.scalars(select(AuditEntry).where(AuditEntry.user_id == user.id)))
    assert [entry.action for entry in entries] == ["bucket.created"]


def test_an_action_rolls_back_when_its_audit_entry_fails(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bucket must not exist if the entry recording it never landed.

    ADR 002 A17's guarantee runs in this direction: an action that
    succeeded without its audit row is worse than one that failed, because
    the row is the only record that it happened at all.

    Built on its own client because raise_server_exceptions defaults to
    True, which would re-raise the failure instead of letting the app's
    handler render it.
    """
    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as failing_client:
        user = sign_in(failing_client, db_session, "api-audit-atomic")

        def explode(*args: object, **kwargs: object) -> None:
            raise RuntimeError("audit writer unavailable")

        monkeypatch.setattr("app.routers.buckets.record_audit", explode)

        response = failing_client.post("/v1/buckets", json={"name": "orphan"})

    assert response.status_code == 500
    assert (
        db_session.scalars(
            select(Bucket).where(Bucket.user_id == user.id, Bucket.name == "orphan")
        ).one_or_none()
        is None
    )


def test_no_key_material_reaches_the_logs(
    client: TestClient, db_session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """Invariant 1, exercised against the only secret material SP3 holds.

    Scoped to the application's own loggers on purpose. SQLAlchemy also
    renders bound parameters into a statement error's str(exc), which would
    include a wrapped DEK; that surface is closed by hide_parameters=True in
    create_db_engine (see test_the_engine_hides_bound_parameters in
    test_db.py), not by this test. What this test holds is that our code
    does not leak key material on its own.
    """
    user = sign_in(client, db_session, "api-quiet")
    caplog.set_level(logging.DEBUG, logger="app")

    client.post("/v1/buckets", json={"name": "quiet"})
    bucket = db_session.scalars(
        select(Bucket).where(Bucket.user_id == user.id, Bucket.name == "quiet")
    ).one()
    dek = unwrap_dek(get_key_provider(), bucket)
    client.delete("/v1/buckets/quiet")

    output = "\n".join(
        record.getMessage() for record in caplog.records if record.name.startswith("app")
    )
    assert dek.hex() not in output
    assert base64.b64encode(dek).decode() not in output
    assert bucket.wrapped_dek.hex() not in output
