import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Deliberately not the bucket rule. The use case is environment variables and
# ADR 002's own example is DATABASE_URL, which A16's lowercase pattern rejects
# outright. Case sensitive, mirroring how environment variables behave. See
# ADR 002 A22.
KEY_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"

# Checked against encoded bytes, never a character count. Pydantic's
# max_length counts characters, so a limit expressed that way lets a string of
# four byte characters weigh four times what the number says.
MAX_VALUE_BYTES = 64 * 1024


class Secret(Base):
    """One encrypted value, bound by AAD to its bucket and key name.

    ciphertext holds nonce || ciphertext || tag as a single blob, which is
    what encrypt returns and what decrypt expects. Three columns would mean
    disassembling the cipher's own output on write and reassembling it on
    read, with a chance of getting the offsets wrong at both ends. See ADR
    002 A20.

    No key version column: rotating the KEK rewraps bucket DEKs and never
    touches these rows. See ADR 002 A15.
    """

    __tablename__ = "secrets"
    __table_args__ = (
        UniqueConstraint("bucket_id", "key_name", name="uq_secrets_bucket_id_key_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    bucket_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("buckets.id", ondelete="CASCADE"), nullable=False
    )
    key_name: Mapped[str] = mapped_column(Text, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        # Omits ciphertext. Not because it is readable without the DEK, but
        # because a log line is a different trust boundary from the database
        # and there is no reason for the same bytes to sit in both.
        return f"<Secret bucket_id={self.bucket_id} key_name={self.key_name!r}>"
