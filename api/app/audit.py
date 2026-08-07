"""Recording what happened, never what it contained. See ADR 002 A17."""

import uuid

from sqlalchemy.orm import Session

from app.models import AuditEntry

BUCKET_CREATED = "bucket.created"
BUCKET_DELETED = "bucket.deleted"


def record_audit(
    session: Session,
    *,
    user_id: uuid.UUID,
    action: str,
    bucket_name: str | None = None,
    key_name: str | None = None,
    api_key_id: uuid.UUID | None = None,
) -> AuditEntry:
    """Append one audit entry inside the caller's transaction.

    Every field is a named parameter and there is no dict, no **kwargs and
    no request body anywhere in the signature. That is CLAUDE.md invariant
    1's allowlist expressed in code: no argument exists through which a
    plaintext secret value could arrive, whether by accident or by a future
    caller taking a shortcut.

    Deliberately does not commit. The entry commits with the action it
    describes, so an action can never succeed without its audit row.
    """
    entry = AuditEntry(
        user_id=user_id,
        action=action,
        bucket_name=bucket_name,
        key_name=key_name,
        api_key_id=api_key_id,
    )
    session.add(entry)
    session.flush()
    return entry
