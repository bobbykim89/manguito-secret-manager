import base64
import hashlib
from urllib.parse import parse_qs, urlparse

from app.auth.google import (
    GoogleClient,
    GoogleIdentity,
    _is_verified,
    get_google_client,
    pkce_challenge,
)
from app.config import Settings


def settings_for() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment="local",
        google_client_id="the-client-id",
        google_client_secret="the-secret",
        google_redirect_uri="http://testserver/v1/auth/google/callback",
        app_url="http://testserver",
    )


def test_pkce_challenge_is_unpadded_base64url_sha256() -> None:
    verifier = "abc123"
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )

    assert pkce_challenge(verifier) == expected
    assert "=" not in pkce_challenge(verifier)


def test_authorization_url_carries_state_challenge_and_scopes() -> None:
    client = GoogleClient(settings_for())

    url = client.authorization_url("the-state", "the-challenge")
    query = parse_qs(urlparse(url).query)

    assert query["state"] == ["the-state"]
    assert query["code_challenge"] == ["the-challenge"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["client_id"] == ["the-client-id"]
    assert query["redirect_uri"] == ["http://testserver/v1/auth/google/callback"]
    assert set(query["scope"][0].split()) == {"openid", "email", "profile"}


def test_authorization_url_never_contains_the_client_secret() -> None:
    client = GoogleClient(settings_for())

    assert "the-secret" not in client.authorization_url("s", "c")


def test_google_identity_is_immutable() -> None:
    identity = GoogleIdentity(sub="s", email="e@example.com", email_verified=True, name=None)

    try:
        identity.sub = "other"  # type: ignore[misc]
    except Exception:
        return
    raise AssertionError("GoogleIdentity should be frozen")


def test_get_google_client_is_cached() -> None:
    # get_google_client is lru_cache(maxsize=1) so the JWKS cache inside
    # GoogleClient survives across requests. A future edit that drops the
    # cache should fail this test rather than silently regress into a
    # network call on every login.
    get_google_client.cache_clear()
    try:
        assert get_google_client() is get_google_client()
    finally:
        get_google_client.cache_clear()


def test_email_verified_only_true_for_genuine_boolean_true() -> None:
    # _verify_id_token's happy path needs a real Google-signed id_token, so
    # this exercises the exact expression exchange_code relies on rather than
    # going through the network-bound public surface.
    assert _is_verified({"email_verified": True}) is True
    assert _is_verified({"email_verified": "false"}) is False
    assert _is_verified({"email_verified": "true"}) is False
    assert _is_verified({"email_verified": 1}) is False
    assert _is_verified({}) is False
