from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.sessions import lookup_session_user
from app.db import get_db
from app.envelope import ApiError
from app.models import User

UNAUTHENTICATED_MESSAGE = "Authentication is required."


def current_user(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
) -> User:
    """Resolve the caller, or refuse.

    A missing cookie, an unknown token, and an expired session all produce the
    same response, so the endpoint never reveals whether a token existed.
    """
    token = request.cookies.get(SESSION_COOKIE)
    user = lookup_session_user(session, token) if token else None
    if user is None:
        raise ApiError("UNAUTHENTICATED", UNAUTHENTICATED_MESSAGE, status_code=401)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
