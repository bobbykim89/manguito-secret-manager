from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import create_session
from app.models import AuditEntry, Bucket, Secret, User
from app.models.secret import MAX_VALUE_BYTES


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


# Paired rather than hashed, for the reason given in test_secrets_service.py.
ROUND_TRIP_CASES = [
    ("plain", "plain"),
    ("empty", ""),
    ("unicode", "unicode é中\U0001f600"),
    ("newline", "line\nbreak"),
    ("spaces", "  spaced  "),
]


@pytest.mark.parametrize(("label", "value"), ROUND_TRIP_CASES)
def test_a_value_round_trips_through_http(
    client: TestClient, db_session: Session, label: str, value: str
) -> None:
    with_bucket(client, db_session, f"api-round-{label}", "round")

    put = client.put("/v1/buckets/round/secrets/KEY", json={"value": value})
    got = client.get("/v1/buckets/round/secrets/KEY")

    assert put.status_code == 201
    assert got.status_code == 200
    assert got.json()["data"]["value"] == value


def test_replacing_a_key_returns_200_rather_than_201(
    client: TestClient, db_session: Session
) -> None:
    with_bucket(client, db_session, "api-replace", "replace")
    client.put("/v1/buckets/replace/secrets/KEY", json={"value": "first"})

    response = client.put("/v1/buckets/replace/secrets/KEY", json={"value": "second"})

    assert response.status_code == 200
    assert client.get("/v1/buckets/replace/secrets/KEY").json()["data"]["value"] == "second"


def test_the_single_key_read_carries_a_no_store_directive(
    client: TestClient, db_session: Session
) -> None:
    """ADR 002 A21: the one response carrying a plaintext secret must not
    sit behind a cache. Cache-Control: no-store is now applied to every
    response by SecurityHeadersMiddleware, so the list gets it too, but this
    test still exists to prove the single-key read specifically carries it,
    since that's the response A21 is actually about."""
    with_bucket(client, db_session, "api-cache", "cached")
    client.put("/v1/buckets/cached/secrets/KEY", json={"value": "v"})

    got = client.get("/v1/buckets/cached/secrets/KEY")
    listed = client.get("/v1/buckets/cached/secrets")

    assert got.headers.get("cache-control") == "no-store"
    assert listed.headers.get("cache-control") == "no-store"


def test_the_list_returns_metadata_and_never_a_value(
    client: TestClient, db_session: Session
) -> None:
    """Invariant 7. The exact key set is what stops a value or a length
    reaching the list by accident."""
    with_bucket(client, db_session, "api-list", "listing")
    client.put("/v1/buckets/listing/secrets/BETA", json={"value": "secret-b"})
    client.put("/v1/buckets/listing/secrets/ALPHA", json={"value": "secret-a"})

    body = client.get("/v1/buckets/listing/secrets").json()

    assert [item["key_name"] for item in body["data"]] == ["ALPHA", "BETA"]
    assert set(body["data"][0]) == {"key_name", "created_at", "updated_at"}
    assert "secret-a" not in client.get("/v1/buckets/listing/secrets").text


def test_deleting_a_secret_removes_it(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "api-del", "deleting")
    client.put("/v1/buckets/deleting/secrets/KEY", json={"value": "v"})

    response = client.delete("/v1/buckets/deleting/secrets/KEY")

    assert response.status_code == 200
    assert client.get("/v1/buckets/deleting/secrets/KEY").status_code == 404
    assert client.get("/v1/buckets/deleting/secrets").json()["data"] == []


def test_an_absent_key_is_a_404(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "api-absent-key", "absentkey")

    response = client.get("/v1/buckets/absentkey/secrets/NOPE")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SECRET_NOT_FOUND"


def test_deleting_an_absent_key_is_a_404(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "api-absent-del", "absentdel")

    response = client.delete("/v1/buckets/absentdel/secrets/NOPE")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SECRET_NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/buckets/theirs/secrets"),
        ("GET", "/v1/buckets/theirs/secrets/KEY"),
        ("PUT", "/v1/buckets/theirs/secrets/KEY"),
        ("DELETE", "/v1/buckets/theirs/secrets/KEY"),
    ],
)
def test_another_users_bucket_is_a_404_on_every_endpoint(
    client: TestClient, db_session: Session, method: str, path: str
) -> None:
    """Not a 403. A 403 would confirm the bucket exists."""
    # Both GET rows share method="GET"; the path's last segment tells them
    # apart so the two don't collide on the same user sub.
    case = f"{method}-{path.rsplit('/', 1)[-1]}"
    with_bucket(client, db_session, f"api-cross-owner-{case}", "theirs")
    client.put("/v1/buckets/theirs/secrets/KEY", json={"value": "v"})
    sign_in(client, db_session, f"api-cross-other-{case}")

    response = client.request(method, path, json={"value": "v"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "BUCKET_NOT_FOUND"


@pytest.mark.parametrize(
    ("label", "key"),
    [
        ("space", "with space"),
        ("slash", "with/slash"),
        ("leading", "-leading"),
        ("toolong", "x" * 129),
        ("comma", "with,comma"),
    ],
)
def test_invalid_key_names_are_rejected(
    client: TestClient, db_session: Session, label: str, key: str
) -> None:
    with_bucket(client, db_session, f"api-key-bad-{label}", f"badkeys{label}")

    # quote(safe="") so an unsafe character travels as one path segment
    # rather than altering the URL's own structure.
    response = client.put(
        f"/v1/buckets/badkeys{label}/secrets/{quote(key, safe='')}", json={"value": "v"}
    )

    if label == "slash":
        # A slash can never reach the endpoint's own pattern check: ASGI
        # decodes %2F back to "/" before Starlette routes the request, so
        # this never matches the {key} segment and the rejection is the
        # router's 404 rather than the validator's 422. Still rejected,
        # just one layer earlier than the other bad names.
        assert response.status_code == 404
    else:
        assert response.status_code == 422


@pytest.mark.parametrize(
    ("label", "key"),
    [
        ("upper", "DATABASE_URL"),
        ("dotted", "stripe.webhook"),
        ("hyphen", "next-auth"),
        ("single", "A"),
        ("maxlen", "x" * 128),
    ],
)
def test_valid_key_names_are_accepted(
    client: TestClient, db_session: Session, label: str, key: str
) -> None:
    """DATABASE_URL is the case A16's lowercase bucket rule would have rejected."""
    with_bucket(client, db_session, f"api-key-ok-{label}", f"goodkeys{label}")

    response = client.put(
        f"/v1/buckets/goodkeys{label}/secrets/{quote(key, safe='')}", json={"value": "v"}
    )

    assert response.status_code == 201


def test_a_value_at_the_limit_is_accepted_and_one_byte_over_is_not(
    client: TestClient, db_session: Session
) -> None:
    with_bucket(client, db_session, "api-size", "sized")
    value = "a" * MAX_VALUE_BYTES

    at_limit = client.put("/v1/buckets/sized/secrets/AT_LIMIT", json={"value": value})
    over = client.put("/v1/buckets/sized/secrets/OVER", json={"value": "a" * (MAX_VALUE_BYTES + 1)})
    got = client.get("/v1/buckets/sized/secrets/AT_LIMIT")

    assert at_limit.status_code == 201
    assert over.status_code == 422
    assert got.json()["data"]["value"] == value


def test_the_limit_is_measured_in_bytes_through_http(
    client: TestClient, db_session: Session
) -> None:
    """A multi-byte value under the character count is still refused."""
    with_bucket(client, db_session, "api-size-bytes", "sizedbytes")
    value = "é" * (MAX_VALUE_BYTES // 2 + 1)

    response = client.put("/v1/buckets/sizedbytes/secrets/MULTIBYTE", json={"value": value})

    assert len(value) < MAX_VALUE_BYTES
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/buckets/any/secrets"),
        ("GET", "/v1/buckets/any/secrets/KEY"),
        ("PUT", "/v1/buckets/any/secrets/KEY"),
        ("DELETE", "/v1/buckets/any/secrets/KEY"),
    ],
)
def test_every_endpoint_requires_a_session(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={"value": "v"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_each_operation_writes_its_own_audit_action(
    client: TestClient, db_session: Session
) -> None:
    user = with_bucket(client, db_session, "api-audit-secrets", "audited")
    client.put("/v1/buckets/audited/secrets/KEY", json={"value": "one"})
    client.put("/v1/buckets/audited/secrets/KEY", json={"value": "two"})
    client.get("/v1/buckets/audited/secrets/KEY")
    client.delete("/v1/buckets/audited/secrets/KEY")

    entries = list(
        db_session.scalars(
            select(AuditEntry)
            .where(AuditEntry.user_id == user.id, AuditEntry.key_name.is_not(None))
            .order_by(AuditEntry.created_at)
        )
    )
    assert [entry.action for entry in entries] == [
        "secret.created",
        "secret.updated",
        "secret.read",
        "secret.deleted",
    ]
    assert {entry.key_name for entry in entries} == {"KEY"}
    assert {entry.bucket_name for entry in entries} == {"audited"}


def test_the_list_does_not_audit(client: TestClient, db_session: Session) -> None:
    """Only a read of a value is a read. Listing names is not.

    Auditing the list would bury the entries that matter under noise from
    every page load.
    """
    user = with_bucket(client, db_session, "api-audit-list", "auditlist")
    client.put("/v1/buckets/auditlist/secrets/KEY", json={"value": "v"})

    client.get("/v1/buckets/auditlist/secrets")

    entries = list(db_session.scalars(select(AuditEntry).where(AuditEntry.user_id == user.id)))
    assert [entry.action for entry in entries] == ["bucket.created", "secret.created"]


def test_a_read_whose_audit_write_fails_serves_no_value(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unlogged read is worse than a failed read.

    The entry shares the read's transaction, so a read that cannot be
    audited is refused rather than silently served. See ADR 002 A21. This is
    the test that would go red if someone moved the audit write outside the
    transaction to make reads cheaper.

    Built on its own client because raise_server_exceptions defaults to
    True, which would re-raise instead of letting the app's handler render.
    """
    from app.main import app

    def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("audit writer unavailable")

    with TestClient(app, raise_server_exceptions=False) as failing_client:
        with_bucket(failing_client, db_session, "api-read-audit-fails", "auditfail")
        failing_client.put("/v1/buckets/auditfail/secrets/KEY", json={"value": "the-real-value"})
        monkeypatch.setattr("app.routers.secrets.record_audit", explode)

        response = failing_client.get("/v1/buckets/auditfail/secrets/KEY")

    assert response.status_code == 500
    assert "the-real-value" not in response.text


def test_a_racing_concurrent_create_surfaces_as_an_opaque_500(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pins today's behaviour rather than changing it.

    put_secret reads before writing, so two concurrent creates of the same
    new key race and the loser's IntegrityError reaches the unhandled
    handler. The unique constraint still guarantees one row; this only
    proves the failure stays an opaque 500 and never leaks a value.
    """
    from sqlalchemy.exc import IntegrityError

    from app.main import app

    def explode(*args: object, **kwargs: object) -> None:
        raise IntegrityError("INSERT ...", {}, Exception("duplicate"))

    with TestClient(app, raise_server_exceptions=False) as failing_client:
        with_bucket(failing_client, db_session, "api-create-race", "racing")
        monkeypatch.setattr("app.routers.secrets.put_secret", explode)

        response = failing_client.put(
            "/v1/buckets/racing/secrets/KEY", json={"value": "the-losing-value"}
        )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "the-losing-value" not in response.text


def test_a_corrupted_row_fails_without_leaking_anything(db_session: Session) -> None:
    """A tampered ciphertext is a 500 carrying nothing.

    Whether it was a dropped KEK or a tampered row lives in the log, not in
    the response: telling a caller apart would say something about the
    database's state that they have no business learning.
    """
    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as failing_client:
        with_bucket(failing_client, db_session, "api-corrupt", "corrupted")
        failing_client.put("/v1/buckets/corrupted/secrets/KEY", json={"value": "the-real-value"})
        row = db_session.scalars(
            select(Secret)
            .join(Bucket, Bucket.id == Secret.bucket_id)
            .where(Bucket.name == "corrupted", Secret.key_name == "KEY")
        ).one()
        tampered = bytearray(row.ciphertext)
        tampered[-1] ^= 0xFF
        row.ciphertext = bytes(tampered)
        db_session.commit()

        response = failing_client.get("/v1/buckets/corrupted/secrets/KEY")

    assert response.status_code == 500
    assert "the-real-value" not in response.text
    assert "InvalidTag" not in response.text
    assert "ciphertext" not in response.text


def test_reveal_is_refused(client: TestClient, db_session: Session) -> None:
    """A session can never reveal, whatever the user owns.

    ADR 003 requires that a browser cannot reach bulk reveal at all, so this
    is refused for the credential's type rather than for a missing scope.
    """
    with_bucket(client, db_session, "api-reveal", "revealing")
    client.put("/v1/buckets/revealing/secrets/KEY", json={"value": "v"})

    response = client.get("/v1/buckets/revealing/secrets?reveal=true")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "REVEAL_NOT_PERMITTED"


def test_reveal_is_refused_before_the_bucket_is_looked_up(
    client: TestClient, db_session: Session
) -> None:
    """The ordering test, and the only one that proves it.

    Reveal is a property of the credential, per ADR 002 A4, so the refusal
    must not depend on a resource the caller was never entitled to ask
    about. A bucket that does not exist would answer 404 if the lookup ran
    first.
    """
    sign_in(client, db_session, "api-reveal-order")

    response = client.get("/v1/buckets/nosuchbucket/secrets?reveal=true")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "REVEAL_NOT_PERMITTED"


def test_reveal_false_behaves_as_the_default(client: TestClient, db_session: Session) -> None:
    with_bucket(client, db_session, "api-reveal-false", "revealfalse")
    client.put("/v1/buckets/revealfalse/secrets/KEY", json={"value": "v"})

    response = client.get("/v1/buckets/revealfalse/secrets?reveal=false")

    assert response.status_code == 200
    assert set(response.json()["data"][0]) == {"key_name", "created_at", "updated_at"}


def test_an_unparseable_reveal_is_a_422(client: TestClient, db_session: Session) -> None:
    """Declared as a typed boolean rather than read loosely, so a value that
    is neither true nor false is refused rather than treated as absent."""
    with_bucket(client, db_session, "api-reveal-bad", "revealbad")

    response = client.get("/v1/buckets/revealbad/secrets?reveal=maybe")

    assert response.status_code == 422


def test_a_truthy_spelling_of_reveal_still_refuses(client: TestClient, db_session: Session) -> None:
    """Pydantic parses yes, y, on and 1 as true.

    The property that matters is that no spelling is silently ignored, so
    these refuse rather than validate.
    """
    with_bucket(client, db_session, "api-reveal-yes", "revealyes")

    assert client.get("/v1/buckets/revealyes/secrets?reveal=yes").status_code == 403
    assert client.get("/v1/buckets/revealyes/secrets?reveal=1").status_code == 403


def test_reveal_is_refused_after_authentication_is_checked(client: TestClient) -> None:
    """The flip SP4's version of this test predicted.

    While nothing could carry the reveal scope, refusing before
    authentication was correct and the answer was 403. The gate now has to
    know which credential is asking, so authentication resolves first and an
    unauthenticated caller gets 401.
    """
    response = client.get("/v1/buckets/nosuchbucket/secrets?reveal=true")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_reveal_is_not_a_parameter_on_the_single_key_endpoint(
    client: TestClient, db_session: Session
) -> None:
    """A4 scopes reveal to bulk fetch. On a single key it would be
    meaningless, since that endpoint's whole purpose is returning one value
    to a caller already entitled to it."""
    with_bucket(client, db_session, "api-reveal-single", "revealsingle")
    client.put("/v1/buckets/revealsingle/secrets/KEY", json={"value": "v"})

    response = client.get("/v1/buckets/revealsingle/secrets/KEY?reveal=true")

    assert response.status_code == 200
    assert response.json()["data"]["value"] == "v"
