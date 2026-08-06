import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.user import User


class UserSession(Base):
    """A logged in browser session.

    Named UserSession rather than Session because SQLAlchemy's Session is
    imported in nearly every module here and shadowing it produces confusing
    type errors. The table is still `sessions`.

    Only the SHA-256 hash of the token is stored, for the same reason ADR 002
    gives for API keys: a 256 bit random token has no brute force surface, and
    hashing means a stolen database dump does not hand over live sessions.
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True, nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    user: Mapped[User] = relationship()
