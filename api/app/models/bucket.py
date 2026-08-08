import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Restricted so a name can never need URL escaping and can never look like a
# path segment. See ADR 002 A16.
NAME_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,62}$"


class Bucket(Base):
    """A named container owning exactly one wrapped DEK.

    The id is generated in Python rather than by gen_random_uuid, unlike
    User, because the DEK is wrapped with the id as AAD and so the id has to
    exist before the row can be built.

    Deleting a bucket destroys its wrapped DEK, which is what makes any
    ciphertext surviving in an old backup permanently unreadable. That is
    why deletion is hard rather than soft. See ADR 002 A18.
    """

    __tablename__ = "buckets"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_buckets_user_id_name"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    wrapped_dek: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    kek_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        # Omits wrapped_dek deliberately. SQLAlchemy's default repr would put
        # wrapped key material into any log line, traceback or debugger
        # session that touched this object.
        return f"<Bucket id={self.id} name={self.name!r}>"
