"""Exercises the real signature and claims verification path.

Every other test in this module tree injects a FakeGoogleClient, so
exchange_code and _verify_id_token never actually run. That leaves the
function that decides whose account a login resolves to completely
untested: the suite would stay green with the signature check deleted, aud
validation dropped, or algorithms widened to accept HS256. This file closes
that gap with no network I/O, by handing GoogleClient a KeySet built in
memory instead of fetched from Google.
"""

import json
import time
from typing import Any

import pytest
from joserfc import jwt
from joserfc.jwk import KeySet, OctKey, RSAKey

from app.auth.google import GoogleAuthError, GoogleClient
from app.config import Settings

CLIENT_ID = "the-client-id"

VALID_CLAIMS: dict[str, Any] = {
    "iss": "https://accounts.google.com",
    "aud": CLIENT_ID,
    "sub": "google-sub",
    "email": "user@example.com",
    "email_verified": True,
    "name": "A User",
    # Far enough in the future that this suite outlives its usefulness first.
    "exp": 4102444800,
}


def settings_for() -> Settings:
    return Settings(
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment="local",
        google_client_id=CLIENT_ID,
        google_client_secret="the-secret",
        google_redirect_uri="http://testserver/v1/auth/google/callback",
        app_url="http://testserver",
    )


def client_with(key_set: KeySet) -> GoogleClient:
    """A GoogleClient whose JWKS cache is pre-seeded, so nothing reaches the network.

    Accessing the private cache attributes directly is the documented
    tradeoff here: the alternative is a real HTTP call.
    """
    client = GoogleClient(settings_for())
    client._jwks = key_set
    client._jwks_fetched_at = time.monotonic()
    return client


def encode(key: RSAKey, claims: dict[str, Any]) -> str:
    return jwt.encode({"alg": "RS256", "kid": key.kid}, claims, key)


@pytest.fixture
def key() -> RSAKey:
    return RSAKey.generate_key(2048)


@pytest.fixture
def key_set(key: RSAKey) -> KeySet:
    return KeySet([key])


def test_a_valid_token_yields_the_expected_identity(key: RSAKey, key_set: KeySet) -> None:
    client = client_with(key_set)

    claims = client._verify_id_token(encode(key, VALID_CLAIMS))

    assert claims["sub"] == "google-sub"
    assert claims["email"] == "user@example.com"
    assert claims["email_verified"] is True
    assert claims["name"] == "A User"


def test_a_token_signed_by_a_different_key_is_rejected(key_set: KeySet) -> None:
    forger_key = RSAKey.generate_key(2048)
    KeySet([forger_key])  # assigns forger_key.kid, same as the fixture above does
    client = client_with(key_set)
    token = encode(forger_key, VALID_CLAIMS)

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_wrong_audience_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    client = client_with(key_set)
    token = encode(key, {**VALID_CLAIMS, "aud": "someone-elses-client-id"})

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_expired_token_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    client = client_with(key_set)
    token = encode(key, {**VALID_CLAIMS, "exp": 1})

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_wrong_issuer_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    client = client_with(key_set)
    token = encode(key, {**VALID_CLAIMS, "iss": "https://not-google.example.com"})

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_hs256_forgery_using_the_public_key_as_an_hmac_secret_is_rejected(
    key: RSAKey, key_set: KeySet
) -> None:
    """The classic JWKS-as-HMAC-secret attack.

    If algorithms ever widened to accept HS256, anyone could sign their own
    token using Google's published public key material as a symmetric
    secret, because a public key is, well, public. algorithms=["RS256"] is
    the guard that stops this; prove it actually does.
    """
    public_material = json.dumps(key.as_dict(private=False)).encode()
    hmac_key = OctKey.import_key(public_material)
    forged = jwt.encode({"alg": "HS256"}, VALID_CLAIMS, hmac_key)
    client = client_with(key_set)

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(forged)


def test_missing_sub_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    claims = {k: v for k, v in VALID_CLAIMS.items() if k != "sub"}
    client = client_with(key_set)
    token = encode(key, claims)

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_missing_email_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    claims = {k: v for k, v in VALID_CLAIMS.items() if k != "email"}
    client = client_with(key_set)
    token = encode(key, claims)

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)


def test_empty_email_is_rejected(key: RSAKey, key_set: KeySet) -> None:
    client = client_with(key_set)
    token = encode(key, {**VALID_CLAIMS, "email": ""})

    with pytest.raises(GoogleAuthError):
        client._verify_id_token(token)
