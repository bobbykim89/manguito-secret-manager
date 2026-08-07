import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import BUCKET_CREATED, BUCKET_DELETED, record_audit
from app.models import AuditEntry, Bucket, User


def seed_user(session: Session, sub: str) -> User:
    user = User(google_sub=sub, email=f"{sub}@example.com", name="Test")
    session.add(user)
    session.flush()
    return user


def entries_for(session: Session, user: User) -> list[AuditEntry]:
    return list(
        session.scalars(
            select(AuditEntry).where(AuditEntry.user_id == user.id).order_by(AuditEntry.created_at)
        )
    )


def test_record_audit_writes_one_entry(db_session: Session) -> None:
    user = seed_user(db_session, "audit-write")

    record_audit(db_session, user_id=user.id, action=BUCKET_CREATED, bucket_name="prod")
    db_session.commit()

    entries = entries_for(db_session, user)
    assert len(entries) == 1
    assert entries[0].action == BUCKET_CREATED
    assert entries[0].bucket_name == "prod"
    assert entries[0].api_key_id is None
    assert entries[0].key_name is None


def test_an_entry_outlives_the_bucket_it_names(db_session: Session) -> None:
    """The reason bucket_name is text and not a foreign key.

    An FK would cascade here and erase the record of the deletion, which is
    the event most worth keeping.
    """
    user = seed_user(db_session, "audit-survives")
    bucket = Bucket(
        id=uuid.uuid4(),
        user_id=user.id,
        name="doomed",
        wrapped_dek=b"placeholder",
        kek_version=1,
    )
    db_session.add(bucket)
    db_session.flush()

    db_session.delete(bucket)
    record_audit(db_session, user_id=user.id, action=BUCKET_DELETED, bucket_name="doomed")
    db_session.commit()

    assert db_session.get(Bucket, bucket.id) is None
    entries = entries_for(db_session, user)
    assert [entry.action for entry in entries] == [BUCKET_DELETED]
    assert entries[0].bucket_name == "doomed"


def test_record_audit_does_not_commit(db_session: Session) -> None:
    """The entry commits with the action it describes, never on its own.

    An action that succeeded without its audit row is worse than an action
    that failed.
    """
    user = seed_user(db_session, "audit-txn")
    db_session.commit()

    record_audit(db_session, user_id=user.id, action=BUCKET_CREATED, bucket_name="rolled-back")
    db_session.rollback()

    assert entries_for(db_session, user) == []


def test_every_field_is_keyword_only() -> None:
    """The signature is the field allowlist.

    Positional arguments would let a caller drift a value into the wrong
    column, and the column most worth protecting is one that must never
    hold a plaintext secret.
    """
    with pytest.raises(TypeError):
        record_audit(None, uuid.uuid4(), BUCKET_CREATED)  # type: ignore[call-arg, arg-type]
