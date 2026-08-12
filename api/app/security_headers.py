"""Response headers applied to every response this API sends.

Deliberately short. CSP, X-Frame-Options and Permissions-Policy are not here:
they constrain how a browser renders a document, and nothing renders these
JSON responses as one. A header that does no work is not free, because it
suggests a protection that is not present.
"""

from fastapi import Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.types import ASGIApp

from app.config import Settings

# nosniff:      a browser must not second guess Content-Type and run a JSON
#               response as script if one is ever loaded outside fetch.
# no-referrer:  secret key names appear in paths, and ADR 002's Transport
#               section already treats the Referer header as a place values
#               must not leak. The same reasoning covers the paths.
# no-store:     nothing in this API is cacheable. Applied globally rather than
#               per route, so a new endpoint cannot forget it.
SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

HSTS_HEADER = "Strict-Transport-Security"

# Two years, subdomains included, and no preload. preload is a one way door:
# leaving the browser preload list is slow and cannot be done in an
# emergency, and this domain does not exist yet.
HSTS_VALUE = "max-age=63072000; includeSubDomains"


def apply_security_headers(response: Response, settings: Settings) -> None:
    """Set the headers on one response.

    A pure function taking a Response, shaped like set_session_cookie, so the
    is_production branch is testable without constructing an application.
    """
    for name, value in SECURITY_HEADERS.items():
        response.headers[name] = value
    # Same gate as the session cookie's Secure flag, for consistency rather
    # than for risk: a browser ignores HSTS over plain http regardless.
    if settings.is_production:
        response.headers[HSTS_HEADER] = HSTS_VALUE


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Applies the headers to everything that comes back through the stack.

    BaseHTTPMiddleware buffers responses, which would break streaming. This
    API has none: every response is a small JSON envelope.

    It does not cover a 500 from unhandled_exception_handler. Starlette routes
    the handler registered for Exception into ServerErrorMiddleware, which
    sits outside all user middleware, so that response never passes back
    through here. A later change closes that gap by calling the same function
    from envelope.py.
    """

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        apply_security_headers(response, self.settings)
        return response
