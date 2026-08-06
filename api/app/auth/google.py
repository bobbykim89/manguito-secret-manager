import base64
import hashlib
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet
from joserfc.jwt import JWTClaimsRegistry

from app.config import Settings, get_settings

# Google's endpoints are stable and documented. Hardcoding them avoids a
# discovery request on every login for values that have not changed in years.
AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
VALID_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
SCOPES = "openid email profile"
_JWKS_TTL_SECONDS = 3600


class GoogleAuthError(Exception):
    """The exchange failed, or the identity Google returned is not usable."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None


class GoogleOAuthClient(Protocol):
    def authorization_url(self, state: str, code_challenge: str) -> str: ...

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity: ...


def pkce_challenge(verifier: str) -> str:
    """S256 challenge: unpadded base64url of the verifier's SHA-256."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _is_verified(claims: dict[str, Any]) -> bool:
    """True only for a genuine JSON boolean true.

    This claim is not in the JWTClaimsRegistry, so nothing else checks its
    type, and it gates account creation. A stray truthy value like the string
    "false" must read as unverified, not verified.
    """
    return claims.get("email_verified") is True


class GoogleClient:
    """Real Google client.

    Kept behind GoogleOAuthClient so tests inject a fake and the suite never
    reaches the network, the same shape ADR 002 uses for KeyProvider.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks: KeySet | None = None
        self._jwks_fetched_at = 0.0

    def authorization_url(self, state: str, code_challenge: str) -> str:
        query = urlencode(
            {
                "client_id": self._settings.google_client_id,
                "redirect_uri": self._settings.google_redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "access_type": "online",
                "prompt": "select_account",
            }
        )
        return f"{AUTHORIZE_ENDPOINT}?{query}"

    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity:
        try:
            response = httpx.post(
                TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": self._settings.google_client_id,
                    "client_secret": self._settings.google_client_secret,
                    "redirect_uri": self._settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            raise GoogleAuthError("token endpoint unreachable") from exc

        if response.status_code != 200:
            # Never include the body: it can echo the client secret back.
            raise GoogleAuthError(f"token endpoint returned {response.status_code}")

        id_token = response.json().get("id_token")
        if not id_token:
            raise GoogleAuthError("token response carried no id_token")

        claims = self._verify_id_token(id_token)
        return GoogleIdentity(
            sub=str(claims["sub"]),
            email=str(claims.get("email", "")),
            email_verified=_is_verified(claims),
            name=claims.get("name"),
        )

    def _key_set(self) -> KeySet:
        now = time.monotonic()
        if self._jwks is None or now - self._jwks_fetched_at > _JWKS_TTL_SECONDS:
            try:
                keys = httpx.get(JWKS_ENDPOINT, timeout=10.0).json()
            except httpx.HTTPError as exc:
                raise GoogleAuthError("jwks endpoint unreachable") from exc
            self._jwks = KeySet.import_key_set(keys)
            self._jwks_fetched_at = now
        return self._jwks

    def _verify_id_token(self, id_token: str) -> dict[str, Any]:
        """Verify the signature, then the claims.

        Signature first: an unverified token's claims are attacker controlled,
        so validating them before checking the signature would be validating
        whatever the attacker wrote.
        """
        try:
            token = jwt.decode(id_token, self._key_set(), algorithms=["RS256"])
        except JoseError as exc:
            raise GoogleAuthError("id_token failed signature verification") from exc

        registry = JWTClaimsRegistry(
            iss={"essential": True, "values": sorted(VALID_ISSUERS)},
            aud={"essential": True, "value": self._settings.google_client_id},
            exp={"essential": True},
            sub={"essential": True},
        )
        try:
            registry.validate(token.claims)
        except JoseError as exc:
            raise GoogleAuthError("id_token claims failed validation") from exc

        return dict(token.claims)


@lru_cache(maxsize=1)
def get_google_client() -> GoogleOAuthClient:
    # get_settings is itself lru_cache(maxsize=1), so the settings object is
    # already process-lifetime; caching the client changes nothing about
    # staleness and lets the JWKS cache in GoogleClient actually survive
    # across requests. dependency_overrides replaces this callable by
    # identity, so overriding it in tests is unaffected by the cache.
    return GoogleClient(get_settings())
