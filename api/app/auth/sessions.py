import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import User, UserSession

SESSION_LIFETIME = timedelta(days=7)

# 32 bytes of entropy. token_urlsafe returns roughly 4/3 characters per byte.
_TOKEN_BYTES = 32


def generate_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> bytes:
    """SHA-256 rather than a slow KDF.

    A 256 bit random token has no brute force surface, and this runs on every
    authenticated request, so a deliberately slow hash would be pure latency.
    Same reasoning ADR 002 applies to API keys.
    """
    return hashlib.sha256(token.encode()).digest()


def create_session(session: Session, user: User) -> tuple[str, UserSession]:
    """Create a session and return the plaintext token with its row.

    The plaintext is returned rather than stored: it goes into the cookie and
    is never persisted anywhere.
    """
    token = generate_token()
    row = UserSession(
        token_hash=hash_token(token),
        user_id=user.id,
        expires_at=datetime.now(UTC) + SESSION_LIFETIME,
    )
    session.add(row)
    session.flush()
    return token, row


def lookup_session_user(session: Session, token: str) -> User | None:
    statement = (
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.expires_at > datetime.now(UTC),
        )
    )
    return session.execute(statement).scalar_one_or_none()


def delete_session(session: Session, token: str) -> None:
    session.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))


def purge_expired_sessions(session: Session, user: User) -> None:
    """Housekeeping, not enforcement.

    Expiry is enforced by the lookup query. This keeps the table from growing
    without bound, and runs at login because Fly stops the machine when idle
    so there is no always on process to sweep from.
    """
    session.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.expires_at <= datetime.now(UTC),
        )
    )
