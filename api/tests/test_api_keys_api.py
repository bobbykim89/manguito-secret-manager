from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api_keys import PREFIX
from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.models import ApiKey, AuditEntry, User

KEY_FIELDS = {
    "id",
    "lookup_id",
    "name",
    "buckets",
    "can_write",
    "can_reveal",
    "expires_at",
    "revoked_at",
    "last_used_at",
    "created_at",
}


def sign_in(client: TestClient, session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return user


def with_bucket(client: TestClient, session: Session, sub: str, name: str) -> User:
    user = sign_in(client, session, sub)
    client.post("/v1/buckets", json={"name": name})
    return user


def create_body(bucket: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": "ci",
        "buckets": [bucket],
        "can_write": False,
        "can_reveal": False,
    }
    body.update(overrides)
    return body


def test_creating_a_key_returns_the_token_once(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-create", "prod")

    response = client.post("/v1/keys", json=create_body("prod"))

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["token"].startswith(PREFIX)
    assert set(data) == KEY_FIELDS | {"token"}


def test_the_token_never_appears_again(client: TestClient, db_session: Session) -> None:
    """The whole point of storing a hash. If the list could return it, the
    hash would be decoration."""
    with_bucket(client, db_session, "keys-once", "once")
    token = client.post("/v1/keys", json=create_body("once")).json()["data"]["token"]

    listing = client.get("/v1/keys")

    assert token not in listing.text
    assert set(listing.json()["data"][0]) == KEY_FIELDS


def test_the_creation_response_is_not_cacheable(client: TestClient, db_session: Session) -> None:
    """It carries a live credential, the same hazard as a revealed secret."""
    with_bucket(client, db_session, "keys-nostore", "nostore")

    response = client.post("/v1/keys", json=create_body("nostore"))

    assert response.headers["Cache-Control"] == "no-store"


def test_the_list_reports_the_scope_by_name(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-scope", "alpha")
    client.post("/v1/buckets", json={"name": "beta"})
    client.post("/v1/keys", json=create_body("alpha", buckets=["beta", "alpha"]))

    data = client.get("/v1/keys").json()["data"]

    assert data[0]["buckets"] == ["alpha", "beta"]


def test_an_empty_bucket_list_is_rejected(client: TestClient, db_session: Session) -> None:
    """A key that can reach nothing has no reason to exist."""
    with_bucket(client, db_session, "keys-empty", "empty")

    response = client.post("/v1/keys", json=create_body("empty", buckets=[]))

    assert response.status_code == 422


def test_a_bucket_that_is_not_yours_is_a_404(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-theirs", "theirsbucket")
    sign_in(client, db_session, "keys-mine")

    response = client.post("/v1/keys", json=create_body("theirsbucket"))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "BUCKET_NOT_FOUND"


def test_an_expiry_in_the_past_is_rejected(client: TestClient, db_session: Session) -> None:
    """A key born dead is a configuration mistake, not a valid request."""
    with_bucket(client, db_session, "keys-past", "past")
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()

    response = client.post("/v1/keys", json=create_body("past", expires_at=past))

    assert response.status_code == 422


def test_a_naive_expiry_is_rejected(client: TestClient, db_session: Session) -> None:
    """An offset-less timestamp is what a hand written curl sends.

    Without an offset there is no way to know which instant was meant, and
    comparing it against an aware now raises rather than answering.
    """
    with_bucket(client, db_session, "keys-naive", "naive")

    response = client.post("/v1/keys", json=create_body("naive", expires_at="2027-01-01T00:00:00"))

    assert response.status_code == 422


def test_revoking_marks_the_key(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-revoke", "revoking")
    key_id = client.post("/v1/keys", json=create_body("revoking")).json()["data"]["id"]

    response = client.delete(f"/v1/keys/{key_id}")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "data": {"revoked": True}}
    assert client.get("/v1/keys").json()["data"][0]["revoked_at"] is not None


def test_revoking_twice_succeeds_without_moving_the_timestamp(
    client: TestClient, db_session: Session
) -> None:
    user = with_bucket(client, db_session, "keys-revoke-twice", "revoketwice")
    key_id = client.post("/v1/keys", json=create_body("revoketwice")).json()["data"]["id"]
    client.delete(f"/v1/keys/{key_id}")
    first = client.get("/v1/keys").json()["data"][0]["revoked_at"]

    second_response = client.delete(f"/v1/keys/{key_id}")

    assert second_response.status_code == 200
    assert client.get("/v1/keys").json()["data"][0]["revoked_at"] == first
    entries = list(
        db_session.scalars(
            select(AuditEntry).where(
                AuditEntry.user_id == user.id, AuditEntry.action == "apikey.revoked"
            )
        )
    )
    assert len(entries) == 1


def test_a_malformed_key_id_is_a_422(client: TestClient, db_session: Session) -> None:
    """Declared on the route so the generated schema matches what is sent."""
    sign_in(client, db_session, "keys-bad-id")

    response = client.delete("/v1/keys/not-a-uuid")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_revoking_another_users_key_is_a_404(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-cross-owner", "crossowner")
    key_id = client.post("/v1/keys", json=create_body("crossowner")).json()["data"]["id"]
    sign_in(client, db_session, "keys-cross-other")

    response = client.delete(f"/v1/keys/{key_id}")

    assert response.status_code == 404


def test_the_list_shows_only_your_keys(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-list-theirs", "listtheirs")
    client.post("/v1/keys", json=create_body("listtheirs", name="theirs"))
    with_bucket(client, db_session, "keys-list-mine", "listmine")
    client.post("/v1/keys", json=create_body("listmine", name="mine"))

    data = client.get("/v1/keys").json()["data"]

    assert [item["name"] for item in data] == ["mine"]


def test_revoked_keys_stay_in_the_list(client: TestClient, db_session: Session) -> None:
    """A revoked key is exactly what you want to see when reconstructing what
    happened."""
    with_bucket(client, db_session, "keys-list-revoked", "listrevoked")
    key_id = client.post("/v1/keys", json=create_body("listrevoked")).json()["data"]["id"]
    client.delete(f"/v1/keys/{key_id}")

    data = client.get("/v1/keys").json()["data"]

    assert len(data) == 1
    assert data[0]["revoked_at"] is not None


def test_creating_and_revoking_are_audited(client: TestClient, db_session: Session) -> None:
    user = with_bucket(client, db_session, "keys-audit", "keysaudit")
    key_id = client.post("/v1/keys", json=create_body("keysaudit")).json()["data"]["id"]
    client.delete(f"/v1/keys/{key_id}")

    entries = list(
        db_session.scalars(
            select(AuditEntry).where(AuditEntry.user_id == user.id).order_by(AuditEntry.created_at)
        )
    )
    assert [entry.action for entry in entries] == [
        "bucket.created",
        "apikey.created",
        "apikey.revoked",
    ]


def test_no_audit_entry_ever_carries_the_token(client: TestClient, db_session: Session) -> None:
    user = with_bucket(client, db_session, "keys-audit-quiet", "auditquiet")

    token = client.post("/v1/keys", json=create_body("auditquiet")).json()["data"]["token"]

    entries = list(db_session.scalars(select(AuditEntry).where(AuditEntry.user_id == user.id)))
    rendered = " ".join(f"{entry.action} {entry.bucket_name} {entry.key_name}" for entry in entries)
    assert token not in rendered


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/v1/keys"), ("POST", "/v1/keys"), ("DELETE", "/v1/keys/{id}")],
)
def test_an_api_key_cannot_reach_key_management(
    client: TestClient, db_session: Session, method: str, path: str
) -> None:
    """ADR 002 A25. A leaked key must not be able to mint another one, and
    the endpoint enforces that by never reading the header at all."""
    with_bucket(client, db_session, f"keys-boundary-{method}", f"boundary{method.lower()}")
    created = client.post("/v1/keys", json=create_body(f"boundary{method.lower()}")).json()["data"]
    client.cookies.clear()

    response = client.request(
        method,
        path.format(id=created["id"]),
        json=create_body(f"boundary{method.lower()}"),
        headers={"Authorization": f"Bearer {created['token']}"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_a_repeated_bucket_name_is_scoped_once(client: TestClient, db_session: Session) -> None:
    """A scope is a set. The join table's composite key would otherwise
    reject the second row and turn a harmless client mistake into a 500."""
    with_bucket(client, db_session, "keys-dupe", "dupebucket")

    response = client.post(
        "/v1/keys", json=create_body("dupebucket", buckets=["dupebucket", "dupebucket"])
    )

    assert response.status_code == 201
    assert response.json()["data"]["buckets"] == ["dupebucket"]


def test_the_stored_hash_is_never_returned(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "keys-hash", "hashing")
    client.post("/v1/keys", json=create_body("hashing"))

    key = db_session.scalars(select(ApiKey).where(ApiKey.name == "ci")).first()

    assert key is not None
    assert key.token_hash.hex() not in client.get("/v1/keys").text
