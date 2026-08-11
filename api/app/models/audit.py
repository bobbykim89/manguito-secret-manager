import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AuditEntry(Base):
    """One recorded action. Never a secret value. See ADR 002 A17.

    bucket_name is text rather than a foreign key on purpose: an FK would
    cascade on bucket deletion and destroy the record of that deletion,
    which is the event most worth keeping. An audit log has to outlive its
    subjects.

    user_id does cascade, which is a different case rather than an
    inconsistency. There is no user deletion in v1, and if one arrives it
    will be an erasure request, where removing the person's audit rows is
    the intended outcome rather than data loss.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_user_id_created_at", "user_id", "created_at"),
        Index("ix_audit_log_api_key_id", "api_key_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL rather than CASCADE: an entry must outlive the key it names,
    # for the same reason bucket_name is text. See ADR 002 A17.
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    bucket_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
