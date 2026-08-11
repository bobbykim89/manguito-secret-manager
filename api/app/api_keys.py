"""Issuing and verifying API keys. See ADR 002 A24."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApiKey, ApiKeyBucket, Bucket, User

PREFIX = "msm_"
LOOKUP_ID_CHARS = 8

# token_hex(4) is 8 lowercase hex characters, which contain no underscore, so
# the token can be split at its first separator without ambiguity. The secret
# from token_urlsafe may contain underscores, and does not need to be parsed.
_LOOKUP_ID_BYTES = 4
_SECRET_BYTES = 32

# Compared against when no key matches, so a missing lookup id takes the same
# path as a wrong secret. The lookup id is 32 bits and not worth guessing, but
# a timing difference costs nothing to remove.
_ABSENT_HASH = hashlib.sha256(b"no key with this lookup id").digest()


def generate_token() -> tuple[str, str]:
    """Return the token and its lookup id.

    The lookup id is not secret and carries no entropy claim: it exists so
    verification is one indexed query rather than a scan that hashes every
    candidate. The 32 random bytes are the credential.
    """
    lookup_id = secrets.token_hex(_LOOKUP_ID_BYTES)
    return f"{PREFIX}{lookup_id}_{secrets.token_urlsafe(_SECRET_BYTES)}", lookup_id


def parse_token(token: str) -> str | None:
    """Return the lookup id, or None if the token is not even well formed.

    Splits once at the first separator, because the secret segment may itself
    contain underscores.
    """
    if not token.startswith(PREFIX):
        return None
    lookup_id, separator, secret = token[len(PREFIX) :].partition("_")
    if not separator or not secret or len(lookup_id) != LOOKUP_ID_CHARS:
        return None
    return lookup_id


def hash_token(token: str) -> bytes:
    """SHA-256 of the whole token, never of the secret segment alone.

    Defence in depth rather than today's load bearing control. What actually
    refuses a token pairing one key's lookup id with another key's secret is
    verify_token resolving exactly the row that id names and comparing only
    against it. Covering the whole token keeps the stored digest from being a
    function of the secret alone, which is what would matter if that lookup
    ever changed shape, and it costs nothing.
    """
    return hashlib.sha256(token.encode("utf-8")).digest()


def verify_token(session: Session, token: str) -> ApiKey | None:
    """Resolve a token to a live key, or None.

    Every failure returns None so the caller produces one identical 401: a
    malformed token, an unknown lookup id, a wrong secret, a revoked key and
    an expired key are indistinguishable from outside.

    Both sides of the comparison are bytes. compare_digest raises TypeError
    on a str containing non-ASCII, which in SP2 escaped a failure path
    entirely and returned a 500 with a live credential still set.
    """
    lookup_id = parse_token(token)
    if lookup_id is None:
        return None
    key = session.scalars(select(ApiKey).where(ApiKey.lookup_id == lookup_id)).one_or_none()
    if key is None:
        secrets.compare_digest(hash_token(token), _ABSENT_HASH)
        return None
    if not secrets.compare_digest(hash_token(token), key.token_hash):
        return None
    if key.revoked_at is not None:
        return None
    if key.expires_at is not None and key.expires_at <= datetime.now(UTC):
        return None
    return key


def create_key(
    session: Session,
    user: User,
    *,
    name: str,
    buckets: list[Bucket],
    can_write: bool,
    can_reveal: bool,
    expires_at: datetime | None,
) -> tuple[ApiKey, str]:
    """Insert a key and return it with its plaintext token.

    The plaintext is returned rather than stored: it goes to the caller once
    and exists nowhere afterwards. Flushes but does not commit, so the caller
    commits it with the audit entry that records it.
    """
    token, lookup_id = generate_token()
    key = ApiKey(
        user_id=user.id,
        lookup_id=lookup_id,
        token_hash=hash_token(token),
        name=name,
        can_write=can_write,
        can_reveal=can_reveal,
        expires_at=expires_at,
    )
    session.add(key)
    session.flush()
    session.add_all([ApiKeyBucket(api_key_id=key.id, bucket_id=bucket.id) for bucket in buckets])
    session.flush()
    return key, token


def get_key(session: Session, user: User, key_id: uuid.UUID) -> ApiKey | None:
    """Look up one key, scoped to its owner.

    The user_id filter is what makes another user's key indistinguishable
    from one that does not exist.
    """
    return session.scalars(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id)
    ).one_or_none()


def list_keys_with_buckets(session: Session, user: User) -> list[tuple[ApiKey, list[str]]]:
    """Every key the user owns, each with the bucket names it may reach.

    Two queries rather than an aggregate: array_agg over an outer join needs
    a FILTER to avoid returning a list containing one null for a key whose
    buckets have all been deleted, which is more machinery than a second
    indexed query costs.
    """
    keys = list(
        session.scalars(select(ApiKey).where(ApiKey.user_id == user.id).order_by(ApiKey.created_at))
    )
    if not keys:
        return []
    pairs = session.execute(
        select(ApiKeyBucket.api_key_id, Bucket.name)
        .join(Bucket, Bucket.id == ApiKeyBucket.bucket_id)
        .where(ApiKeyBucket.api_key_id.in_([key.id for key in keys]))
    ).all()
    names: dict[uuid.UUID, list[str]] = {key.id: [] for key in keys}
    for api_key_id, bucket_name in pairs:
        names[api_key_id].append(bucket_name)
    return [(key, sorted(names[key.id])) for key in keys]


def revoke_key(key: ApiKey) -> bool:
    """Set revoked_at once, returning whether this call did it.

    Revoking twice keeps the first timestamp: the moment a credential stopped
    being trusted is the fact worth preserving.
    """
    if key.revoked_at is not None:
        return False
    key.revoked_at = datetime.now(UTC)
    return True


def touch_key(session: Session, key: ApiKey) -> None:
    """Record that the credential was presented, in its own transaction.

    Committed before the endpoint runs, so a request that authenticates and
    then fails still records the use. That is what matters when reviewing a
    suspected leak.
    """
    key.last_used_at = datetime.now(UTC)
    session.commit()
