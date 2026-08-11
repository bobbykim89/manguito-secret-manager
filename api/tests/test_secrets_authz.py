import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.models import User


def sign_in(client: TestClient, session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    token, _ = create_session(session, user)
    session.commit()
    client.cookies.set(SESSION_COOKIE, token)
    return user


def issue(
    client: TestClient,
    buckets: list[str],
    *,
    can_write: bool = False,
    can_reveal: bool = False,
) -> tuple[str, str]:
    """Return the token and the created key's id.

    The id matters because the shared database is never truncated, so any
    assertion about a key has to name the one it issued rather than
    whichever row happens to be newest.
    """
    body = {
        "name": "ci",
        "buckets": buckets,
        "can_write": can_write,
        "can_reveal": can_reveal,
    }
    data = client.post("/v1/keys", json=body).json()["data"]
    return str(data["token"]), str(data["id"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def setup_account(client: TestClient, session: Session, sub: str, buckets: list[str]) -> User:
    user = sign_in(client, session, sub)
    for name in buckets:
        client.post("/v1/buckets", json={"name": name})
        client.put(f"/v1/buckets/{name}/secrets/KEY", json={"value": f"{name}-value"})
    return user


def test_a_key_reads_a_secret_in_scope(client: TestClient, db_session: Session) -> None:
    setup_account(client, db_session, "authz-read", ["inscope"])
    token, _ = issue(client, ["inscope"])
    client.cookies.clear()

    response = client.get("/v1/buckets/inscope/secrets/KEY", headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["data"]["value"] == "inscope-value"


def test_a_bucket_outside_the_scope_is_a_404(client: TestClient, db_session: Session) -> None:
    """Not a 403. A leaked key probing bucket names must learn nothing,
    which is the entire point of scoping it. See ADR 002 A26."""
    setup_account(client, db_session, "authz-scope", ["allowed", "denied"])
    token, _ = issue(client, ["allowed"])
    client.cookies.clear()

    response = client.get("/v1/buckets/denied/secrets/KEY", headers=bearer(token))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "BUCKET_NOT_FOUND"


def test_an_out_of_scope_bucket_answers_exactly_like_a_missing_one(
    client: TestClient, db_session: Session
) -> None:
    """Byte identical, so there is nothing to infer from the difference."""
    setup_account(client, db_session, "authz-identical", ["allowed2", "denied2"])
    token, _ = issue(client, ["allowed2"])
    client.cookies.clear()

    out_of_scope = client.get("/v1/buckets/denied2/secrets/KEY", headers=bearer(token))
    never_existed = client.get("/v1/buckets/nosuchbucket/secrets/KEY", headers=bearer(token))

    assert out_of_scope.status_code == never_existed.status_code == 404
    assert out_of_scope.json()["error"]["code"] == never_existed.json()["error"]["code"]


@pytest.mark.parametrize(
    ("label", "method", "path", "body"),
    [
        ("put", "PUT", "/v1/buckets/nowrite/secrets/NEW", {"value": "v"}),
        ("delete", "DELETE", "/v1/buckets/nowrite/secrets/KEY", None),
    ],
)
def test_a_key_without_write_is_refused(
    client: TestClient,
    db_session: Session,
    label: str,
    method: str,
    path: str,
    body: dict[str, str] | None,
) -> None:
    """403 rather than 404, because the caller has already proved it may see
    the bucket, so refusing tells it nothing new."""
    setup_account(client, db_session, f"authz-nowrite-{label}", ["nowrite"])
    token, _ = issue(client, ["nowrite"], can_write=False)
    client.cookies.clear()

    response = client.request(method, path, json=body, headers=bearer(token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "WRITE_NOT_PERMITTED"


def test_a_key_with_write_may_write(client: TestClient, db_session: Session) -> None:
    setup_account(client, db_session, "authz-write", ["writing"])
    token, _ = issue(client, ["writing"], can_write=True)
    client.cookies.clear()

    created = client.put(
        "/v1/buckets/writing/secrets/NEW", json={"value": "v"}, headers=bearer(token)
    )
    deleted = client.delete("/v1/buckets/writing/secrets/KEY", headers=bearer(token))

    assert created.status_code == 201
    assert deleted.status_code == 200


def test_a_key_may_list_metadata_in_scope(client: TestClient, db_session: Session) -> None:
    setup_account(client, db_session, "authz-list", ["listing"])
    token, _ = issue(client, ["listing"])
    client.cookies.clear()

    response = client.get("/v1/buckets/listing/secrets", headers=bearer(token))

    assert response.status_code == 200
    assert [item["key_name"] for item in response.json()["data"]] == ["KEY"]


def test_a_revoked_key_stops_working(client: TestClient, db_session: Session) -> None:
    setup_account(client, db_session, "authz-revoked", ["revokedscope"])
    body = client.post(
        "/v1/keys",
        json={"name": "ci", "buckets": ["revokedscope"], "can_write": False, "can_reveal": False},
    ).json()["data"]
    client.delete(f"/v1/keys/{body['id']}")
    client.cookies.clear()

    response = client.get("/v1/buckets/revokedscope/secrets/KEY", headers=bearer(body["token"]))

    assert response.status_code == 401


def test_a_key_cannot_reach_the_bucket_endpoints(client: TestClient, db_session: Session) -> None:
    """The boundary is structural: those endpoints never read the header."""
    setup_account(client, db_session, "authz-buckets", ["bucketboundary"])
    token, _ = issue(client, ["bucketboundary"])
    client.cookies.clear()

    assert client.get("/v1/buckets", headers=bearer(token)).status_code == 401
    assert (
        client.post("/v1/buckets", json={"name": "new"}, headers=bearer(token)).status_code == 401
    )
    assert client.delete("/v1/buckets/bucketboundary", headers=bearer(token)).status_code == 401


def test_using_a_key_records_it_on_the_audit_entry(client: TestClient, db_session: Session) -> None:
    """What makes the log able to say which credential did something rather
    than only which person."""
    from sqlalchemy import select

    from app.models import AuditEntry

    user = setup_account(client, db_session, "authz-audit", ["auditing"])
    body = client.post(
        "/v1/keys",
        json={"name": "ci", "buckets": ["auditing"], "can_write": False, "can_reveal": False},
    ).json()["data"]
    client.cookies.clear()

    client.get("/v1/buckets/auditing/secrets/KEY", headers=bearer(body["token"]))

    entry = db_session.scalars(
        select(AuditEntry)
        .where(AuditEntry.user_id == user.id, AuditEntry.action == "secret.read")
        .order_by(AuditEntry.created_at.desc())
    ).first()
    assert entry is not None
    assert str(entry.api_key_id) == body["id"]


def test_a_failed_request_still_records_the_key_as_used(
    client: TestClient, db_session: Session
) -> None:
    """The timestamp rides its own transaction, not the endpoint's.

    A request that authenticates and then 404s is exactly the shape of a
    leaked key being probed, and it must leave a trace.
    """
    import uuid

    from app.models import ApiKey

    setup_account(client, db_session, "authz-touch-fail", ["touchfail"])
    token, key_id = issue(client, ["touchfail"])
    client.cookies.clear()

    response = client.get("/v1/buckets/touchfail/secrets/NOSUCHKEY", headers=bearer(token))

    assert response.status_code == 404
    key = db_session.get(ApiKey, uuid.UUID(key_id))
    assert key is not None
    assert key.last_used_at is not None


def test_a_session_still_reads_and_writes(client: TestClient, db_session: Session) -> None:
    """The cookie path must be untouched by any of this."""
    setup_account(client, db_session, "authz-session", ["sessionpath"])

    read = client.get("/v1/buckets/sessionpath/secrets/KEY")
    written = client.put("/v1/buckets/sessionpath/secrets/OTHER", json={"value": "v"})

    assert read.status_code == 200
    assert written.status_code == 201
