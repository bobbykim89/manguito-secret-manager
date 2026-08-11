import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api_keys import touch_key, verify_token
from app.auth.cookies import SESSION_COOKIE
from app.auth.dependencies import UNAUTHENTICATED_MESSAGE
from app.auth.sessions import lookup_session_user
from app.db import get_db
from app.envelope import ApiError
from app.models import Bucket, User


@dataclass(frozen=True)
class Caller:
    """Who is asking, and what they may do.

    Holds plain values rather than the ApiKey row, because touch_key commits
    and a commit expires every instance in the session. The user is a live
    row, deliberately, because get_bucket takes one; it is loaded after that
    commit so it starts fresh, and it stays valid until the endpoint's own
    commit. Anything reading it must do so before then, which is what the
    endpoints already do.

    The three questions live here rather than in the endpoints so a future
    endpoint cannot answer them differently by forgetting.
    """

    user: User
    api_key_id: uuid.UUID | None
    can_write: bool
    can_reveal: bool
    scoped_bucket_ids: frozenset[uuid.UUID]

    def may_access(self, bucket: Bucket) -> bool:
        """Whether this credential's scope covers the bucket.

        Deliberately not an ownership check. Ownership is settled by the
        lookup that produced the bucket, which filters on user_id, so a
        session answers yes to anything it was handed. This answers only
        whether an API key was scoped to it.
        """
        return self.api_key_id is None or bucket.id in self.scoped_bucket_ids

    def may_write(self) -> bool:
        return self.can_write

    def may_reveal(self) -> bool:
        return self.can_reveal


def _refuse() -> ApiError:
    return ApiError("UNAUTHENTICATED", UNAUTHENTICATED_MESSAGE, status_code=401)


def current_caller(request: Request, session: Annotated[Session, Depends(get_db)]) -> Caller:
    """Resolve a session cookie or a bearer token.

    If an Authorization header is present it decides, and a failure there is
    a 401 with no fallback to the cookie. Falling back would not be a
    privilege escalation, since the cookie user is who they are, but it would
    silently serve a CI script whose key expired three weeks ago.
    """
    header = request.headers.get("Authorization")
    if header is not None:
        return _from_bearer(session, header)

    token = request.cookies.get(SESSION_COOKIE)
    user = lookup_session_user(session, token) if token else None
    if user is None:
        raise _refuse()
    # A session may write and may never reveal, whatever the user owns.
    # ADR 003 requires that a browser cannot reach bulk reveal at all.
    return Caller(
        user=user,
        api_key_id=None,
        can_write=True,
        can_reveal=False,
        scoped_bucket_ids=frozenset(),
    )


def _from_bearer(session: Session, header: str) -> Caller:
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _refuse()
    key = verify_token(session, token)
    if key is None:
        raise _refuse()
    # Every read of key happens before touch_key commits, which expires it.
    user_id = key.user_id
    api_key_id = key.id
    can_write = key.can_write
    can_reveal = key.can_reveal
    scoped_bucket_ids = frozenset(row.bucket_id for row in key.buckets)

    touch_key(session, key)

    # Loaded after the commit rather than before, so the instance is fresh
    # rather than expired. Carrying it across would make the first read of
    # caller.user issue a refresh inside request handling, and a refresh that
    # failed would report a 500 for a request whose credential use had
    # already been committed.
    user = session.get(User, user_id)
    if user is None:
        raise _refuse()
    return Caller(
        user=user,
        api_key_id=api_key_id,
        can_write=can_write,
        can_reveal=can_reveal,
        scoped_bucket_ids=scoped_bucket_ids,
    )


CurrentCaller = Annotated[Caller, Depends(current_caller)]
