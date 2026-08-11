import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

NAME_MAX_LENGTH = 64


class ApiKey(Base):
    """A credential a machine presents, in place of a browser session.

    Only the SHA-256 of the whole token is stored, per invariant 6 and ADR
    002 A24. Slow hashing exists to defend low entropy human passwords
    against offline cracking; a 256 bit random token has no brute force
    surface, and this hash runs on every API request, so a deliberately slow
    KDF would be pure latency on the hot path.

    Hashing the whole token rather than only its secret segment is defence in
    depth rather than the load bearing control. What actually refuses a token
    pairing one key's lookup id with another key's secret is verify_token
    resolving exactly the row that id names and comparing only against it.
    Covering the whole token keeps the stored digest from being a function of
    the secret alone, which is what would matter if that lookup ever changed
    shape.
    """

    __tablename__ = "api_keys"
    __table_args__ = (UniqueConstraint("lookup_id", name="uq_api_keys_lookup_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lookup_id: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    can_write: Mapped[bool] = mapped_column(Boolean, nullable=False)
    can_reveal: Mapped[bool] = mapped_column(Boolean, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # selectin rather than lazy loading, because the scope is read on every
    # authenticated request and a lazy load there would be one query per
    # request hiding behind an attribute access.
    buckets: Mapped[list["ApiKeyBucket"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        # Omits token_hash, for the same reason Bucket omits its wrapped key:
        # a log line is a different trust boundary from the database.
        return f"<ApiKey id={self.id} lookup_id={self.lookup_id!r} name={self.name!r}>"


class ApiKeyBucket(Base):
    """One bucket an API key may reach.

    A join table rather than an array column, so an orphaned scope is the
    database's problem rather than application code remembering to prune.
    Deleting a bucket cascades away exactly the rows naming it and leaves the
    key working on its others. See ADR 002 A25.
    """

    __tablename__ = "api_key_buckets"

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True
    )
    bucket_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("buckets.id", ondelete="CASCADE"), primary_key=True
    )
