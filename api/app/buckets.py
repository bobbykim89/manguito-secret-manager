"""Bucket persistence and the DEK handling that goes with it."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crypto.keys import KeyProvider, generate_dek, wrap_aad
from app.models import Bucket, User


def create_bucket(session: Session, provider: KeyProvider, user: User, name: str) -> Bucket:
    """Generate a DEK, wrap it under the current KEK, and insert.

    The id is minted here rather than by the database, because it is the AAD
    the DEK is wrapped under and so has to exist before the row does.

    Flushes but does not commit: the caller commits it together with the
    audit entry that records it.
    """
    bucket_id = uuid.uuid4()
    bucket = Bucket(
        id=bucket_id,
        user_id=user.id,
        name=name,
        wrapped_dek=provider.wrap(generate_dek(), wrap_aad(bucket_id)),
        kek_version=provider.current_version,
    )
    session.add(bucket)
    session.flush()
    return bucket


def unwrap_dek(provider: KeyProvider, bucket: Bucket) -> bytes:
    """Recover a bucket's DEK.

    SP4's secret endpoints are the real callers. It exists now because it is
    the only way to prove a stored row is recoverable, which is what the
    create path's test asserts.
    """
    return provider.unwrap(bucket.wrapped_dek, bucket.kek_version, wrap_aad(bucket.id))


def get_bucket(session: Session, user: User, name: str) -> Bucket | None:
    """Look up one bucket, scoped to its owner.

    The user_id filter is what makes another user's bucket indistinguishable
    from one that does not exist, so the API never confirms a name is taken.
    """
    return session.scalars(
        select(Bucket).where(Bucket.user_id == user.id, Bucket.name == name)
    ).one_or_none()


def list_buckets(session: Session, user: User) -> list[Bucket]:
    return list(
        session.scalars(select(Bucket).where(Bucket.user_id == user.id).order_by(Bucket.name))
    )
