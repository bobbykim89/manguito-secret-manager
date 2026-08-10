"""Reading and writing encrypted secret values.

Named secrets_service rather than secrets. Python 3's absolute imports mean a
local secrets.py would not actually shadow the standard library module that
app.auth.sessions imports, but a security sensitive module whose name collides
with `secrets` is an ambiguity worth one word to remove.
"""

import logging

from cryptography.exceptions import InvalidTag
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.buckets import unwrap_dek
from app.crypto.aead import build_aad, decrypt, encrypt
from app.crypto.keys import KeyProvider, UnknownKekVersion
from app.models import Bucket, Secret
from app.models.secret import MAX_VALUE_BYTES

logger = logging.getLogger(__name__)


class SecretTooLargeError(ValueError):
    """The encoded value is larger than MAX_VALUE_BYTES."""


def encode_value(value: str) -> bytes:
    """Encode, and enforce the limit on bytes rather than characters.

    Enforced here as well as in the request model so the limit follows the
    value rather than the one endpoint that happens to declare it.
    """
    raw = value.encode("utf-8")
    if len(raw) > MAX_VALUE_BYTES:
        # Report the sizes, never the value.
        raise SecretTooLargeError(f"value is {len(raw)} bytes, limit is {MAX_VALUE_BYTES}")
    return raw


def get_secret(session: Session, bucket: Bucket, key_name: str) -> Secret | None:
    return session.scalars(
        select(Secret).where(Secret.bucket_id == bucket.id, Secret.key_name == key_name)
    ).one_or_none()


def list_secrets(session: Session, bucket: Bucket) -> list[Secret]:
    return list(
        session.scalars(
            select(Secret).where(Secret.bucket_id == bucket.id).order_by(Secret.key_name)
        )
    )


def put_secret(
    session: Session, provider: KeyProvider, bucket: Bucket, key_name: str, value: str
) -> tuple[Secret, bool]:
    """Create or replace, returning the row and whether it was created.

    Flushes but does not commit: the caller commits it together with the
    audit entry that records it.

    Two concurrent writes of the same new key race here, and the loser gets
    an IntegrityError. The unique constraint still guarantees one row, so the
    data is never wrong and the failure is retryable. An upsert that also has
    to report whether it created costs more complexity than that trade is
    worth at this scale.
    """
    blob = encrypt(
        unwrap_dek(provider, bucket), encode_value(value), build_aad(bucket.id, key_name)
    )
    secret = get_secret(session, bucket, key_name)
    if secret is not None:
        secret.ciphertext = blob
        session.flush()
        return secret, False
    secret = Secret(bucket_id=bucket.id, key_name=key_name, ciphertext=blob)
    session.add(secret)
    session.flush()
    return secret, True


def read_secret(provider: KeyProvider, bucket: Bucket, secret: Secret) -> str:
    """Decrypt, or fail loudly having said which failure it was.

    The caller gets one 500 either way and should: telling them apart would
    say something about the database's state. The operator needs the
    distinction, because an unknown KEK version is a configuration mistake
    that restoring the key undoes, while a failed tag means the row does not
    authenticate, which is an incident.

    Both log lines name their fields explicitly. Neither carries the value,
    the ciphertext or the DEK.
    """
    aad = build_aad(bucket.id, secret.key_name)
    try:
        plaintext = decrypt(unwrap_dek(provider, bucket), secret.ciphertext, aad)
    except UnknownKekVersion:
        logger.error(
            "secret decrypt failed: KEK version %s is not configured, bucket=%s key=%s",
            bucket.kek_version,
            bucket.id,
            secret.key_name,
        )
        raise
    except InvalidTag:
        logger.error(
            "secret decrypt failed: ciphertext does not authenticate, bucket=%s key=%s",
            bucket.id,
            secret.key_name,
        )
        raise
    return plaintext.decode("utf-8")
