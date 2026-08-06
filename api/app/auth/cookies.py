from fastapi import Response

from app.auth.sessions import SESSION_LIFETIME
from app.config import Settings

SESSION_COOKIE = "msm_session"
OAUTH_COOKIE = "msm_oauth"
OAUTH_COOKIE_PATH = "/v1/auth"
OAUTH_COOKIE_MAX_AGE = 600

# Both halves come from secrets.token_urlsafe, whose alphabet excludes ".",
# so a single dot is an unambiguous separator and avoids encoding JSON.
_SEPARATOR = "."


def _domain(settings: Settings) -> str | None:
    return settings.session_cookie_domain or None


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        domain=_domain(settings),
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        domain=_domain(settings),
        path="/",
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )


def set_oauth_cookie(response: Response, state: str, verifier: str, settings: Settings) -> None:
    """Hold the CSRF state and the PKCE verifier for one login attempt.

    Not signed. The protection is a double submit comparison: state binds the
    callback to the browser that began the flow, and an attacker who tampers
    still needs a Google authorization matching the value they chose.
    """
    response.set_cookie(
        OAUTH_COOKIE,
        f"{state}{_SEPARATOR}{verifier}",
        max_age=OAUTH_COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        domain=_domain(settings),
        path=OAUTH_COOKIE_PATH,
    )


def read_oauth_cookie(raw: str | None) -> tuple[str, str] | None:
    if not raw:
        return None
    parts = raw.split(_SEPARATOR)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]


def clear_oauth_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        OAUTH_COOKIE,
        domain=_domain(settings),
        path=OAUTH_COOKIE_PATH,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )
