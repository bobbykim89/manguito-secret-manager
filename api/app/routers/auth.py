import logging
import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.cookies import (
    OAUTH_COOKIE,
    SESSION_COOKIE,
    clear_oauth_cookie,
    clear_session_cookie,
    read_oauth_cookie,
    set_oauth_cookie,
    set_session_cookie,
)
from app.auth.dependencies import CurrentUser
from app.auth.google import (
    GoogleAuthError,
    GoogleIdentity,
    GoogleOAuthClient,
    get_google_client,
    pkce_challenge,
)
from app.auth.sessions import create_session, delete_session, purge_expired_sessions
from app.config import Settings, get_settings
from app.db import get_db
from app.envelope import Err, Ok
from app.models import User

logger = logging.getLogger(__name__)

# Endpoints a browser navigates to redirect on failure; endpoints JavaScript
# calls return the ADR 002 envelope. /me and /logout are the second kind.
# Tasks that add /google/start and /google/callback add the first kind.
router = APIRouter(prefix="/v1/auth", tags=["auth"])


class MeData(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None


@router.get("/me", response_model=Ok[MeData], responses={401: {"model": Err}})
def me(user: CurrentUser) -> Ok[MeData]:
    return Ok(data=MeData(id=user.id, email=user.email, name=user.name))


_STATE_BYTES = 32
_VERIFIER_BYTES = 64


def upsert_user(session: Session, identity: GoogleIdentity) -> User:
    """Find by google_sub, or create. Email and name are refreshed on login.

    google_sub is the identity because it is stable forever, while an email
    address can change or be reassigned to a different person.
    """
    user = session.execute(select(User).where(User.google_sub == identity.sub)).scalar_one_or_none()
    if user is None:
        user = User(google_sub=identity.sub, email=identity.email, name=identity.name)
        session.add(user)
        session.flush()
        return user
    user.email = identity.email
    user.name = identity.name
    return user


@router.get("/google/start", include_in_schema=False)
def google_start(
    settings: Annotated[Settings, Depends(get_settings)],
    google: Annotated[GoogleOAuthClient, Depends(get_google_client)],
) -> RedirectResponse:
    state = secrets.token_urlsafe(_STATE_BYTES)
    verifier = secrets.token_urlsafe(_VERIFIER_BYTES)
    response = RedirectResponse(
        google.authorization_url(state, pkce_challenge(verifier)), status_code=307
    )
    set_oauth_cookie(response, state, verifier, settings)
    return response


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    google: Annotated[GoogleOAuthClient, Depends(get_google_client)],
    session: Annotated[Session, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> Response:
    """Complete the login.

    A browser navigates here directly, so failures redirect with an error code
    rather than rendering the envelope. A user whose consent screen failed
    should not be looking at JSON in their address bar.
    """

    def fail(reason: str) -> Response:
        response = RedirectResponse(f"{settings.app_url}/login?error={reason}", status_code=307)
        clear_oauth_cookie(response, settings)
        return response

    if error is not None:
        return fail("CONSENT_DENIED")

    stored = read_oauth_cookie(request.cookies.get(OAUTH_COOKIE))
    if (
        stored is None
        or state is None
        or not secrets.compare_digest(stored[0].encode(), state.encode())
    ):
        return fail("INVALID_STATE")

    if code is None:
        return fail("EXCHANGE_FAILED")

    try:
        identity = google.exchange_code(code, stored[1])
    except GoogleAuthError:
        return fail("EXCHANGE_FAILED")
    except Exception:
        # The redirect contract is that every exit path clears the OAuth
        # cookie. A bare except is normally wrong, but here it is the thing
        # that makes that contract hold by construction rather than by
        # enumerating the exception types the client happens to raise today.
        logger.exception("unexpected error exchanging the authorization code")
        return fail("EXCHANGE_FAILED")

    if not identity.email_verified:
        return fail("EMAIL_NOT_VERIFIED")

    try:
        # Guarded end to end, not just exchange_code: a concurrent first
        # login for the same google_sub can raise IntegrityError at flush,
        # and that exception is just as capable of escaping this handler and
        # leaving the OAuth cookie set as anything exchange_code raises.
        user = upsert_user(session, identity)
        purge_expired_sessions(session, user)
        token, _ = create_session(session, user)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("unexpected error persisting the login")
        return fail("EXCHANGE_FAILED")

    response = RedirectResponse(settings.app_url, status_code=307)
    set_session_cookie(response, token, settings)
    clear_oauth_cookie(response, settings)
    return response


class LogoutData(BaseModel):
    signed_out: bool


@router.post("/logout", response_model=Ok[LogoutData])
def logout(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_db)],
) -> Ok[LogoutData]:
    """Destroy the session.

    Succeeds even when nothing matched. Reporting whether a session existed
    would answer a question the caller has no business asking, and there is
    nothing useful for a client to do differently either way.
    """
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        delete_session(session, token)
        session.commit()
    clear_session_cookie(response, settings)
    return Ok(data=LogoutData(signed_out=True))
