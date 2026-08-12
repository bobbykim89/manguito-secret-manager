# Security headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put four security headers on every response the API sends, including the one that bypasses middleware entirely.

**Architecture:** One new module holds the header values and a single pure function shaped like `set_session_cookie`. A middleware applies it to the normal path; `unhandled_exception_handler` applies it to the 500 path, which Starlette routes outside the middleware stack. `Cache-Control: no-store` becomes a global default, so three hand-picked per-route lines come out.

**Tech Stack:** FastAPI, Starlette middleware, pytest with `TestClient`.

## Global Constraints

- Backend only. Nothing under `web/` changes, and `make types` must produce no diff, since no Pydantic response model changes.
- **No new dependency.**
- Python 3.12+, type hints everywhere, mypy clean over `app scripts alembic tests`.
- ruff with `select = ["E","F","I","N","UP","B","SIM"]`, line length 100.
- Tests use a real Postgres via testcontainers, not SQLite.
- **Exactly these four headers. No `Content-Security-Policy`, no `X-Frame-Options`, no `Permissions-Policy`.** They constrain HTML rendering and this API renders none; setting them would be decoration a scanner rewards rather than a control that works.
- HSTS value is exactly `max-age=63072000; includeSubDomains`, with **no `preload`**.
- HSTS is gated on `settings.is_production`, matching `app/auth/cookies.py`.
- Plaintext secrets are never logged and never reach a response body. Nothing here touches a body, but the 500 path is one this plan edits, so the existing no-detail guarantee must survive.
- No em dashes in code, comments, or commit messages.
- Comments explain why, not what.
- Commit messages: conventional commits, imperative mood, scoped (`feat(api): ...`, `test(api): ...`, `refactor(api): ...`).

---

## File Structure

```
api/
├── app/
│   ├── security_headers.py       new: the values, the pure function, the middleware
│   ├── main.py                   modify: register the middleware
│   ├── envelope.py               modify: apply headers in the 500 handler
│   └── routers/
│       ├── secrets.py            modify: remove two Cache-Control lines
│       └── api_keys.py           modify: remove one Cache-Control line
└── tests/
    └── test_security_headers.py  new
```

`security_headers.py` holds both the function and the middleware because the
middleware is three lines and exists only to call the function. Splitting them
would produce a file whose entire content is one import and one `dispatch`.

---

### Task 1: The header values and the pure function

**Files:**
- Create: `api/app/security_headers.py`
- Create: `api/tests/test_security_headers.py`

**Interfaces:**
- Consumes: `Settings` from `app.config`, which already exposes `is_production`.
- Produces:
  - `SECURITY_HEADERS: dict[str, str]` (the three ungated headers)
  - `HSTS_HEADER: str` = `"Strict-Transport-Security"`
  - `HSTS_VALUE: str` = `"max-age=63072000; includeSubDomains"`
  - `apply_security_headers(response: Response, settings: Settings) -> None`

The function is shaped deliberately like
`set_session_cookie(response, token, settings)` in `app/auth/cookies.py`: it
takes a `Response`, mutates its headers, returns nothing. That shape is what
lets the `is_production` branch be tested without building an application,
which is exactly how `tests/test_auth_cookies.py` tests the `Secure` flag.

No middleware in this task. A pure function with no framework wiring is worth
its own review gate.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_security_headers.py`:

```python
from fastapi import Response

from app.config import Settings
from app.security_headers import (
    HSTS_HEADER,
    HSTS_VALUE,
    SECURITY_HEADERS,
    apply_security_headers,
)


def settings_for(environment: str) -> Settings:
    """Every field passed explicitly, and the dotenv source disabled.

    Mirrors the helper in test_auth_cookies.py, which exists for the same
    reason: Settings otherwise reads ../.env, so a developer with a different
    ENVIRONMENT set locally would see a different result than CI.

    SECRETS_KEKS and SECRETS_KEK_VERSION are not passed. conftest.py sets both
    in os.environ at import time, and Settings reads the process environment
    for anything not given here.
    """
    return Settings(
        _env_file=None,
        database_url="postgresql+psycopg://u:p@localhost:5433/db",
        cors_origins="",
        environment=environment,
        google_client_id="id",
        google_client_secret="secret",
        google_redirect_uri="http://testserver/cb",
        app_url="http://testserver",
        session_cookie_domain="",
    )


def test_the_ungated_headers_are_set() -> None:
    response = Response()

    apply_security_headers(response, settings_for("local"))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_hsts_is_sent_in_production() -> None:
    response = Response()

    apply_security_headers(response, settings_for("production"))

    assert response.headers[HSTS_HEADER] == HSTS_VALUE


def test_hsts_is_absent_locally() -> None:
    # Same gate as the session cookie's Secure flag. A browser ignores HSTS
    # over plain http anyway, so this is about following one convention for
    # environment-dependent security settings rather than about risk.
    response = Response()

    apply_security_headers(response, settings_for("local"))

    assert HSTS_HEADER not in response.headers


def test_hsts_does_not_ask_for_preload() -> None:
    # preload is a one way door: the browser preload list is slow to leave
    # and impossible to leave quickly. The domain is not even purchased yet.
    assert "preload" not in HSTS_VALUE


def test_no_html_rendering_headers_are_set() -> None:
    """Nothing renders this API's responses as HTML.

    CSP, X-Frame-Options and Permissions-Policy constrain how a browser
    renders a document. Setting them here would be decoration a header
    scanner rewards rather than a control doing work, so their absence is
    pinned rather than left to drift in later.
    """
    response = Response()

    apply_security_headers(response, settings_for("production"))

    assert "Content-Security-Policy" not in response.headers
    assert "X-Frame-Options" not in response.headers
    assert "Permissions-Policy" not in response.headers


def test_the_ungated_set_is_exactly_three() -> None:
    assert set(SECURITY_HEADERS) == {
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Cache-Control",
    }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.security_headers'`.

- [ ] **Step 3: Write the module**

Create `api/app/security_headers.py`:

```python
"""Response headers applied to every response this API sends.

Deliberately short. CSP, X-Frame-Options and Permissions-Policy are not here:
they constrain how a browser renders a document, and nothing renders these
JSON responses as one. A header that does no work is not free, because it
suggests a protection that is not present.
"""

from fastapi import Response

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
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add app/security_headers.py tests/test_security_headers.py
git commit -m "feat(api): add the security header values and their applier

A pure function shaped like set_session_cookie, so the is_production gate is
testable without building an application. CSP and X-Frame-Options are
deliberately absent and their absence is pinned by a test."
```

---

### Task 2: Apply them to every normal response

**Files:**
- Create: the middleware class inside `api/app/security_headers.py`
- Modify: `api/app/main.py:26-31` (register beside `CORSMiddleware`)
- Modify: `api/tests/test_security_headers.py` (append)

**Interfaces:**
- Consumes: `apply_security_headers`, `SECURITY_HEADERS` from Task 1.
- Produces: `SecurityHeadersMiddleware`, registered with a `settings` keyword argument.

`BaseHTTPMiddleware` is the simple choice and its usual objection does not
apply: it buffers responses, which breaks streaming, and this API has no
`StreamingResponse` and no `text/event-stream` anywhere. Every response is a
small JSON envelope.

Registered **after** `CORSMiddleware` so `main.py` reads top to bottom as "who
may call this", then "what the browser does with what comes back". Order does
not matter functionally, since the two set disjoint header names.

**This task does not cover the 500 path.** That is Task 3, and it is a
separate task because it needs a different mechanism.

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_security_headers.py`. Add these imports at the top
of the file, beside the existing ones:

```python
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.routing import BaseRoute

from app.main import app
```

Then append:

```python
@pytest.mark.parametrize(
    ("path", "expected_status"),
    [
        ("/v1/health", 200),
        ("/v1/buckets", 401),
        ("/v1/nosuchroute", 404),
    ],
)
def test_headers_are_on_every_ordinary_response(
    client: TestClient, path: str, expected_status: int
) -> None:
    """A 200, an authentication failure, and a route that does not exist.

    The 401 and 404 matter as much as the 200: they are rendered by exception
    handlers rather than by a route, and a middleware that only covered
    successful responses would still pass a test that checked one 200.
    """
    response = client.get(path)

    assert response.status_code == expected_status
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


@pytest.fixture
def echo_route() -> Iterator[None]:
    """A route with a required query parameter, so 422 can be reached.

    Copied from the fixture of the same name in test_errors.py, for the same
    reason it exists there. Every real route that validates a path parameter
    also requires a session, so an unauthenticated request to one returns 401
    from the auth dependency and never reaches validation_error_handler at
    all. A throwaway route with no auth is the only way to exercise the 422
    path without building a signed in session.
    """

    def echo(count: int) -> dict[str, int]:
        return {"count": count}

    before: list[BaseRoute] = list(app.router.routes)
    app.add_api_route("/v1/echo", echo, methods=["GET"])
    app.openapi_schema = None
    try:
        yield
    finally:
        app.router.routes[:] = before
        app.openapi_schema = None


def test_headers_are_on_a_validation_failure(client: TestClient, echo_route: None) -> None:
    # 422 comes from validation_error_handler, a fourth distinct path.
    response = client.get("/v1/echo?count=not-a-number")

    assert response.status_code == 422
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"


def test_hsts_is_absent_in_the_test_environment(client: TestClient) -> None:
    # conftest sets ENVIRONMENT=test, which is_production treats as
    # non-production. This pins that the gate is read at request time from
    # real settings rather than hardcoded on.
    response = client.get("/v1/health")

    assert HSTS_HEADER not in response.headers
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: five new tests FAIL with `KeyError: 'x-content-type-options'`.
(The parametrized test counts as three.) The six from Task 1 still pass.

- [ ] **Step 3: Add the middleware to the module**

Append to `api/app/security_headers.py`, and add these imports at the top:

```python
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.types import ASGIApp
```

Then the class:

```python
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Applies the headers to everything that comes back through the stack.

    BaseHTTPMiddleware buffers responses, which would break streaming. This
    API has none: every response is a small JSON envelope.

    It does not cover a 500 from unhandled_exception_handler. Starlette routes
    the handler registered for Exception into ServerErrorMiddleware, which
    sits outside all user middleware, so that response never passes back
    through here. envelope.py closes that gap by calling the same function.
    """

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        apply_security_headers(response, self.settings)
        return response
```

These exact annotations were checked against this project's mypy and ruff
settings and need no suppression, so do not add a `type: ignore`.

- [ ] **Step 4: Register it in main.py**

In `api/app/main.py`, add to the imports:

```python
from app.security_headers import SecurityHeadersMiddleware
```

and after the existing `application.add_middleware(CORSMiddleware, ...)` call:

```python
    # After CORS, so this file reads as "who may call this", then "what the
    # browser does with what comes back". The two set disjoint header names,
    # so the order does not matter functionally.
    application.add_middleware(SecurityHeadersMiddleware, settings=settings)
```

- [ ] **Step 5: Run them and watch them pass**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: PASS, 11 tests.

- [ ] **Step 6: Falsify the middleware**

Comment out the `add_middleware(SecurityHeadersMiddleware, ...)` line and
re-run. Expected: the four application-level tests that assert a header is present
fail, and the six pure function tests from Task 1 still pass, proving they
test different things.

`test_hsts_is_absent_in_the_test_environment` keeps passing, correctly: it
asserts an absence, and removing the middleware does not make HSTS appear.
That is worth noticing rather than glossing over, because a test that passes
with and without the code under test proves nothing on its own. It earns its
place only alongside `test_hsts_is_sent_in_production` from Task 1, which
fails if the gate is inverted.
Restore the line and confirm green.

Record the actual failure output in the report.

- [ ] **Step 7: Run the whole suite, lint, and commit**

```bash
cd api && uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add app/security_headers.py app/main.py tests/test_security_headers.py
git commit -m "feat(api): apply the security headers to every response

Covers routes and the handled error paths. The unhandled 500 is not covered
by middleware and is closed separately."
```

---

### Task 3: Close the unhandled 500 gap

**Files:**
- Modify: `api/app/envelope.py:110-119` (`unhandled_exception_handler`)
- Modify: `api/tests/test_security_headers.py` (append)

**Interfaces:**
- Consumes: `apply_security_headers` from Task 1.
- Produces: nothing later tasks depend on.

**Read this before writing anything.** Starlette's `build_middleware_stack`
routes the handler registered for `Exception` (or 500) into
`ServerErrorMiddleware`, which is the **outermost** layer, outside all user
middleware. So a response from `unhandled_exception_handler` never passes back
through `SecurityHeadersMiddleware`.

This was verified by probe against this project's own FastAPI version, and it
contradicted the design's first draft:

```
/ok        status=200  X-Probe='reached'
/http404   status=404  X-Probe='reached'
/boom      status=500  X-Probe=None
```

Handled exceptions are fine, because `ExceptionMiddleware` is innermost. Only
the unhandled path escapes.

`tests/test_errors.py` already documents the related fact in its
`unsafe_client` fixture docstring: `ServerErrorMiddleware` re-raises after the
handler runs, which is why inspecting the rendered 500 needs
`raise_server_exceptions=False`.

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_security_headers.py`. Add this import beside the
existing ones (`app` is already imported by Task 2):

```python
from app.db import get_db
```

Then append:

```python
def test_headers_are_on_an_unhandled_five_hundred(migrated_engine: object) -> None:
    """The one response that does not pass through the middleware.

    Starlette puts the Exception handler in ServerErrorMiddleware, outside
    every user middleware, so this is covered by envelope.py calling the same
    function rather than by SecurityHeadersMiddleware. Deleting that call
    makes this test, and only this test, fail.

    raise_server_exceptions=False so the rendered body comes back instead of
    the exception being re-raised into the test.
    """

    def exploding_db() -> Iterator[None]:
        raise RuntimeError("boom")
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        with TestClient(app, raise_server_exceptions=False) as unsafe_client:
            response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 500
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_the_five_hundred_still_leaks_nothing(migrated_engine: object) -> None:
    """Guards the edit in Task 3 against weakening invariant 1.

    envelope.py's 500 handler is being modified, and the property that matters
    most about it is that str(exc) never reaches the body.
    """

    def exploding_db() -> Iterator[None]:
        raise RuntimeError("hunter2-should-never-reach-the-client")
        yield

    app.dependency_overrides[get_db] = exploding_db
    try:
        with TestClient(app, raise_server_exceptions=False) as unsafe_client:
            response = unsafe_client.get("/v1/health")
    finally:
        app.dependency_overrides.clear()

    assert "hunter2-should-never-reach-the-client" not in response.text
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text
```

- [ ] **Step 2: Run them and watch the first fail**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: `test_headers_are_on_an_unhandled_five_hundred` FAILS with a
`KeyError` on the header. `test_the_five_hundred_still_leaks_nothing` PASSES
already, which is correct: it pins existing behaviour that must survive.

This failure is the whole reason this task exists. If it passes before the
change, stop and report, because the premise is wrong.

- [ ] **Step 3: Apply the headers in the 500 handler**

In `api/app/envelope.py`, add to the imports:

```python
from app.config import get_settings
from app.security_headers import apply_security_headers
```

and change `unhandled_exception_handler` to:

```python
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render anything unanticipated as a 500 envelope with no internal detail.

    The message is fixed. `str(exc)` and traceback text can hold row contents,
    connection strings or a plaintext secret, none of which may cross the
    response boundary (CLAUDE.md invariant 1). The real exception goes to the
    server log instead.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    response = _error_response(500, code_for_status(500), INTERNAL_ERROR_MESSAGE)
    # Not redundant with SecurityHeadersMiddleware. Starlette routes the
    # handler registered for Exception into ServerErrorMiddleware, which sits
    # outside every user middleware, so this response never passes back
    # through it. Deleting this line silently strips the headers from exactly
    # the responses nobody tests by hand.
    apply_security_headers(response, get_settings())
    return response
```

The comment is load bearing. Without it the call reads as redundant with the
middleware, and a reader who does not know Starlette's stack order would
reasonably delete it.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: PASS, 13 tests.

- [ ] **Step 5: Falsify the second call site**

Delete the `apply_security_headers(response, get_settings())` line from
`envelope.py` and re-run the file. Expected:
`test_headers_are_on_an_unhandled_five_hundred` fails, and **only** that one.
Restore it and confirm green.

Record the actual failure output in the report. This is the assertion the
whole two-call-site design exists to make true, so a falsification that was
claimed but not run is worse than none.

- [ ] **Step 6: Check for an import cycle**

Run: `cd api && uv run python -c "import app.main; print('ok')"`
Expected: `ok`. `envelope.py` now imports `security_headers`, which imports
`config`. Neither imports `envelope`, so there is no cycle, but a one second
check beats reasoning about it.

- [ ] **Step 7: Run the whole suite, lint, and commit**

```bash
cd api && uv run pytest -q
uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add app/envelope.py tests/test_security_headers.py
git commit -m "fix(api): put the security headers on the unhandled 500 too

Starlette routes the Exception handler into ServerErrorMiddleware, outside
every user middleware, so that one response never reaches
SecurityHeadersMiddleware. Verified by probe, and the test fails if the call
site is removed."
```

---

### Task 4: Remove the three per-route Cache-Control lines

**Files:**
- Modify: `api/app/routers/secrets.py:177` and `:224`
- Modify: `api/app/routers/api_keys.py:132`
- Modify: `api/tests/test_security_headers.py` (append)

**Interfaces:**
- Consumes: the global `Cache-Control: no-store` default from Task 2.
- Produces: nothing.

Three routes set `Cache-Control: no-store` by hand today: the bulk reveal
response, the single secret value response, and the create-key response. They
are the responses carrying a plaintext secret or a live token.

Task 2 made `no-store` global, so these are now redundant. Removing them is
the point of the generalisation: a rule enforced by construction beats a rule
each new endpoint has to remember.

**Pin the behaviour before removing the lines.** Deleting three lines from two
routers without a test that would notice is an unverified change.

- [ ] **Step 1: Find the exact lines**

Run: `cd api && grep -n 'Cache-Control' app/routers/*.py`
Expected: three hits, in `secrets.py` twice and `api_keys.py` once. Use what
this prints; the line numbers above describe the file before this branch.

- [ ] **Step 2: Write the regression tests**

Append to `api/tests/test_security_headers.py`:

```python
def test_a_revealed_secret_is_still_not_cacheable(client: TestClient) -> None:
    """The response that used to set no-store by hand, at secrets.py.

    ADR 002 A21 records that GET on a secret is not safe in the HTTP sense,
    because it writes an audit row. This is what says so on the wire, and it
    has to keep saying it after the per route line is removed.

    A 401 exercises the same route without needing a session, a bucket, a
    secret and a KEK. The header comes from the middleware either way, which
    is exactly the property being pinned.
    """
    response = client.get("/v1/buckets/prod/secrets/DATABASE_URL")

    assert response.headers["Cache-Control"] == "no-store"


def test_the_key_creation_route_is_still_not_cacheable(client: TestClient) -> None:
    """The response that used to set no-store by hand, at api_keys.py.

    It carries the one live credential this API ever returns.
    """
    response = client.post("/v1/keys", json={"name": "n", "buckets": ["b"]})

    assert response.headers["Cache-Control"] == "no-store"
```

- [ ] **Step 3: Run them and watch them pass before the change**

Run: `cd api && uv run pytest tests/test_security_headers.py -v`
Expected: PASS, 15 tests. They pass now because Task 2's global default
already covers these responses. That is the point: they are the safety net for
the deletion in the next step, not a demonstration of new behaviour.

- [ ] **Step 4: Remove the three lines**

In `api/app/routers/secrets.py`, delete both `response.headers["Cache-Control"]
= "no-store"` lines **and the comments directly above them**, since the
comments explain a line that no longer exists.

In `api/app/routers/api_keys.py`, delete the one
`response.headers["Cache-Control"] = "no-store"` line and its comment.

**Three of the four `response: Response` parameters become unused, and go
too.** Verified by reading every use of `response` in both files:

| Endpoint | Other uses of `response` | Parameter |
|---|---|---|
| `secrets.py` `list_endpoint` | none | remove |
| `secrets.py` `get_endpoint` | none | remove |
| `secrets.py` `put_endpoint` | sets `response.status_code` for 201 vs 200 | **keep** |
| `api_keys.py` `create_endpoint` | none | remove |

ruff will not flag these, because `ARG` is not in this project's `select`
list, so an unused parameter would sit there indefinitely. Remove them by
hand.

`Response` is a FastAPI-injected parameter and does not appear in the OpenAPI
schema, so removing it must **not** change `generated.ts`. Task 5 checks that.
If `make types` produces a diff after this, stop and report rather than
committing it.

- [ ] **Step 5: Run the whole suite**

Run: `cd api && uv run pytest -q`
Expected: PASS, everything. The two regression tests still pass, now served by
the middleware rather than the routes.

- [ ] **Step 6: Falsify the regression tests**

The tests in Step 2 passed before the deletion and after it, so on their own
they do not prove the middleware is what covers these routes now. Prove it:
temporarily comment out the `add_middleware(SecurityHeadersMiddleware, ...)`
line in `main.py` and re-run.

Expected: both regression tests fail, because nothing sets the header any
more. Restore the line and confirm green.

Record the actual failure output. Without this step the two tests are the
shape that looks like proof and is not.

- [ ] **Step 7: Confirm nothing else set the header**

Run: `cd api && grep -rn 'Cache-Control' app/`
Expected: hits only in `app/security_headers.py`. If a router still sets it,
the deletion was incomplete.

- [ ] **Step 8: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app scripts alembic tests
git add app/routers/secrets.py app/routers/api_keys.py tests/test_security_headers.py
git commit -m "refactor(api): drop the per route Cache-Control lines

The header is global now, so three hand picked routes setting it are
redundant. A rule enforced by construction beats a rule each new endpoint has
to remember."
```

---

### Task 5: Verify the whole change from the repo root

**Files:**
- Modify: only what a check below finds wrong

**Interfaces:**
- Consumes: everything the previous four tasks built.
- Produces: the finished change.

The per-task steps all ran from `api/`. This runs the checks CI runs, from the
repo root, and confirms the claims the spec makes about scope.

- [ ] **Step 1: The full suite and every linter**

Run: `make lint && make test`
Expected: ruff, ruff format, mypy, eslint and tsc all clean; pytest and vitest
both green. The frontend is untouched, so its numbers must be unchanged.

- [ ] **Step 2: No schema drift**

Run: `make types && git status --short`
Expected: `git status` empty. No Pydantic response model changed, so
`generated.ts` must not move. A diff here means something regenerated against
a stale schema.

- [ ] **Step 3: Nothing outside the backend changed**

Run: `git diff --stat main...HEAD`
Expected: only files under `api/` plus this plan and the spec. Nothing under
`web/`.

- [ ] **Step 4: The header set is exactly what the spec allows**

Run: `cd api && grep -rn 'Content-Security-Policy\|X-Frame-Options\|Permissions-Policy' app/`
Expected: no output. These are out of scope by design, and their absence is
already pinned by a test from Task 1; this confirms none arrived by hand
somewhere else.

- [ ] **Step 5: No new dependency**

Run: `git diff main...HEAD -- api/pyproject.toml api/uv.lock`
Expected: no output. Everything this change needs was already installed.

- [ ] **Step 6: No em dashes**

Run: `cd api && grep -rn "—" app/security_headers.py app/main.py app/envelope.py tests/test_security_headers.py`
Expected: no output.

- [ ] **Step 7: See the headers on a real server, not only in TestClient**

`TestClient` exercises the ASGI app in process. Starting uvicorn proves the
middleware survives a real server too:

```bash
cd api && uv run uvicorn app.main:app --port 8099 &
sleep 2
curl -si http://localhost:8099/v1/health | head -20
kill %1
```

Expected: `x-content-type-options: nosniff`, `referrer-policy: no-referrer`
and `cache-control: no-store` in the response. No
`strict-transport-security`, because the local environment is not production.

If `/v1/health` needs a database this environment does not have, a 503 or 500
is a fine result: the headers are what this step checks, not the status.

- [ ] **Step 8: Commit anything the checks corrected**

```bash
git add -A
git commit -m "fix(api): correct what the verification pass found"
```

If nothing needed fixing, say so in the report and skip the commit. Do not
manufacture a change to have something to commit.

---

## What this deliberately leaves undone

- **CSP, X-Frame-Options, Permissions-Policy.** They constrain HTML rendering
  and nothing renders these responses as HTML. Their absence is pinned by a
  test so it stays a decision rather than becoming an oversight.
- **HSTS `preload`.** A one way door, on a domain that does not exist yet.
- **The frontend's headers.** Vercel serves it and is not configured at all.
- **Per-key rate limiting**, the next hardening piece. It shares the request
  path and nothing else.

## Notes for the executing agent

- `settings.is_production` is false for `local`, `test` and `schema-dump`
  (`api/app/config.py`), so HSTS is absent throughout the test suite. The
  production branch is covered by the pure function tests in Task 1, which
  build a `Settings` directly.
- `tests/conftest.py` sets `SECRETS_KEKS` and `SECRETS_KEK_VERSION` in
  `os.environ` at import time. That is why `settings_for()` can omit them.
- The `client` fixture in `tests/conftest.py` provides a `TestClient` over the
  real `app` and clears `dependency_overrides` afterwards.
- A 500 needs `raise_server_exceptions=False`, or `TestClient` re-raises the
  exception instead of returning the rendered body. `tests/test_errors.py`
  documents this in its `unsafe_client` fixture.
- Task 3's second call site in `envelope.py` is the one thing in this change
  that looks removable and is not. Its comment and its falsifiable test are
  both required, not optional.
