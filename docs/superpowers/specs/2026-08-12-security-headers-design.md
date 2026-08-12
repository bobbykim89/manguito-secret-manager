# Security headers, design

Date: 2026-08-12
Status: Approved, ready for planning
Depends on: the README and threat model piece (merged), ADR 002 as amended

## Purpose

The API sets no security response headers. `api/app/main.py` configures
`CORSMiddleware` and nothing else, so every response leaves without
`Strict-Transport-Security`, `X-Content-Type-Options`, or `Referrer-Policy`,
and only three hand-picked routes set `Cache-Control`.

This is the second of four post-v1 hardening pieces. The README and threat
model shipped first; per-key rate limiting and the KEK rotation CLI remain.

Backend only. No frontend changes, no schema changes, no new dependency.

## Where this sits

Four independent hardening pieces were identified after SP8 closed the
numbered sequence. They are named by topic rather than continuing to SP9,
because SP8's spec closed that sequence explicitly.

| Piece | Touches | Status |
|---|---|---|
| The README and the threat model | docs only | merged |
| **Security headers** | `main.py`, one new module, `envelope.py` | this spec |
| Per-key rate limiting | middleware, storage, config | not started, needs design |
| KEK rotation CLI | `api/scripts/`, crypto | not started, needs design |

This one is second because it has no open architectural question, unlike the
two that remain, and because it touches the request path that rate limiting
will also touch.

## Scope

### In scope

- Four response headers, applied to every response
- A new `app/security_headers.py` holding the values and one pure function
- One middleware registration in `main.py`
- Closing the unhandled-500 gap in `envelope.py`
- Removing three now-redundant per-route `Cache-Control` lines

### Explicitly out of scope

Each with a reason, rather than by omission:

- **Content-Security-Policy, X-Frame-Options, Permissions-Policy.** These
  constrain how a browser renders HTML. This API renders no HTML, serves no
  static files, and is consumed by `fetch` and by `curl`. Setting them would
  be decoration a header scanner rewards rather than a control that does
  work, and this project's standard is not to credit a control with work it
  does not do.
- **The SPA's own headers.** Vercel serves the frontend and is not configured
  at all yet. Different deploy target, different piece.
- **HSTS `preload`.** Submitting a domain to the browser preload list is a
  one-way door: slow to undo and impossible to undo quickly. The domain is
  not purchased yet, so this cannot even be evaluated.
- **Per-key rate limiting.** The next piece. It shares the request path and
  nothing else.

## The headers

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
Strict-Transport-Security: max-age=63072000; includeSubDomains   (production only)
```

**`nosniff`** stops a browser from second-guessing `Content-Type` and
executing a JSON response as script if one is ever loaded outside `fetch`.

**`no-referrer`** keeps this origin's URLs out of the `Referer` header on any
onward request. Secret key names appear in paths, and CLAUDE.md's invariant 2
already treats the `Referer` header as a place credentials must not leak. The
same reasoning covers the paths themselves.

**`no-store`** becomes global rather than per-route. See below.

**HSTS** gets two years and `includeSubDomains`, and is gated on
`settings.is_production`.

### HSTS follows the cookie precedent

`app/auth/cookies.py` gates its `Secure` flag on `settings.is_production`,
which is false for `local`, `test` and `schema-dump`. HSTS uses the same gate.

A browser ignores HSTS over plain HTTP anyway, so sending it unconditionally
would be harmless. It is gated regardless, because this codebase has already
decided how environment-dependent security settings are expressed, and one
header quietly not following that convention is a worse cost than the branch.

### Cache-Control becomes a global default

Three routes set `Cache-Control: no-store` today:
`app/routers/secrets.py:177` and `:224`, and `app/routers/api_keys.py:132`.
They are the responses carrying a plaintext secret or a live token.

Nothing in this API should be cached, not only those three. A global default
also covers every future route without each one remembering, which is the
same structural reasoning ADR 002 A25 applies to key-management endpoints: a
rule enforced by construction beats a rule each new endpoint has to remember.

The three per-route lines are removed as redundant. Their behaviour is pinned
by tests before the removal, so deleting them is verified rather than assumed.

There is a related property worth stating: ADR 002 A21 records that `GET` on a
secret is not safe in the HTTP sense, because it writes an audit row. A global
`no-store` is consistent with that and strengthens it.

## Implementation

A new module, `app/security_headers.py`, holding the header values as module
constants and one pure function:

```python
def apply_security_headers(response: Response, settings: Settings) -> None
```

Shaped deliberately like `set_session_cookie(response, token, settings)`: it
takes a `Response`, mutates its headers, and returns nothing. That shape is
what makes the `is_production` branch testable without constructing an
application, which is exactly how `tests/test_auth_cookies.py` already tests
the `Secure` flag.

`main.py` gains a `SecurityHeadersMiddleware` registration beside the existing
CORS one. Order between the two does not matter functionally, since they set
disjoint header names. It is registered after CORS so the file reads
top to bottom as "who may call this", then "what the browser does with what
comes back".

The middleware form is left to the plan. `BaseHTTPMiddleware` is the simpler
one and its usual objection does not apply here: it buffers responses, which
breaks streaming, and this API has no `StreamingResponse` and no
`text/event-stream` anywhere. Every response is a small JSON envelope.

### The unhandled 500 bypasses middleware entirely

This was verified by probe rather than assumed, and the result contradicted
the first draft of this design.

Starlette's `build_middleware_stack` routes the handler registered for
`Exception` (or 500) into `ServerErrorMiddleware`, which sits **outside** all
user middleware. A response produced by `unhandled_exception_handler`
therefore never passes back through `SecurityHeadersMiddleware`.

The probe, against this project's own FastAPI version:

```
/ok        status=200  X-Probe='reached'
/http404   status=404  X-Probe='reached'
/boom      status=500  X-Probe=None
```

Handled exceptions are fine, because `ExceptionMiddleware` is innermost. Only
the unhandled path escapes.

**The gap is closed by calling the same helper from
`unhandled_exception_handler`** in `app/envelope.py`. Two call sites, one
source of truth, so they cannot drift.

That second call site carries a comment explaining why it exists. Without one
it reads as redundant with the middleware, and a reader who does not know
Starlette's stack order would reasonably delete it.

### Wrapping the ASGI app was considered and rejected on cost

A bare ASGI middleware wrapping `create_app()` would cover every response
uniformly, including this one, from a single place.

It was rejected because `app` would stop being a `FastAPI` instance.
`app.dependency_overrides` is used in `tests/test_health.py`,
`tests/test_auth_flow.py`, `tests/test_errors.py` and `tests/conftest.py`, and
`app.openapi()` in `scripts/dump_openapi.py`. All would need rewriting to
reach through the wrapper, which is a large blast radius for a header module.

## Testing

A new `tests/test_security_headers.py`.

**Unit, with no application:**

- The three ungated headers land on a bare `Response`.
- HSTS is present under `production` and absent under `local`.

These use a local `settings_for()` mirroring the one in
`tests/test_auth_cookies.py`. Two consumers does not yet justify hoisting it
into `conftest.py`; this project extracted `ConfirmPrompt` at three consumers
and `Alert` at six.

**Through the application**, the headers are present on:

- a 200
- a 401
- a 404
- a 422
- **a 500 from the unhandled path**

The last is the assertion the whole shared-helper design exists to make true.
It is falsified by deleting the `envelope.py` call and confirming that this
test, and only this test, fails.

**Regression on the removal:**

- The single-secret endpoint still answers `Cache-Control: no-store`.
- The create-key endpoint still answers `Cache-Control: no-store`.

Without these two, deleting three lines from two routers is an unverified
change.

## Acceptance criteria

1. Every response carries `X-Content-Type-Options: nosniff`.
2. Every response carries `Referrer-Policy: no-referrer`.
3. Every response carries `Cache-Control: no-store`.
4. A 500 from `unhandled_exception_handler` carries all three, proven by a
   test that fails if the `envelope.py` call site is removed.
5. `Strict-Transport-Security: max-age=63072000; includeSubDomains` is sent
   when `settings.is_production` is true.
6. It is absent when `settings.is_production` is false.
7. The three per-route `Cache-Control` lines are removed, and both affected
   endpoints still answer `no-store`.
8. No `Content-Security-Policy`, `X-Frame-Options`, or `Permissions-Policy`
   header is set.
9. No new dependency.
10. `make lint` and `make test` pass, and `make types` produces no diff, since
    no Pydantic response model changes.

## ADR amendments this spec requires

None.

ADR 002's "Transport" section covers TLS and the `Authorization` header, and
says nothing about response headers that would now be contradicted. Nothing
here changes an API shape, an auth rule, or a stored form. The `Cache-Control`
generalisation strengthens A21's "not safe in the HTTP sense" note rather than
amending it.

If the plan finds that a claim in ADR 002's Transport section reads as
superseded once these headers exist, that is an amendment worth writing, but
this design does not anticipate one.

## Risks

**A global `no-store` could mask a future caching decision.** If a genuinely
cacheable endpoint is ever added, a public key set or an OpenAPI document,
the global default silently makes it uncacheable and the author has to notice
and override. Accepted: for a secret manager the safe default is the correct
one, and the override is one line at the route that wants it.

**The `envelope.py` call site is deletable-looking.** It exists only because of
a Starlette stack ordering detail invisible at that line. The comment and the
falsifiable test are the mitigation, and both are required rather than
optional.

**HSTS is hard to walk back.** Two years is a long commitment for a domain
that does not exist yet. `max-age` can be lowered and served for the remainder
of the old window, which is the escape hatch; `preload`, which has no
equivalent, is out of scope for exactly this reason.

**The gating branch is only exercised in tests.** `is_production` is false in
every environment this code has ever actually run in, since nothing is
deployed. The first real HSTS header will be emitted by the first deploy. The
unit test is what stands in for that until then.

## Deferred

To the remaining hardening pieces, each with its own spec: per-key rate
limiting, and the KEK rotation CLI.

Not code, and outstanding: branch protection on `main`, the domain purchase
that unblocks SP1 Task 12, the GitGuardian false positive on
`POSTGRES_PASSWORD: manguito`, and setting `SECRETS_KEKS` and
`SECRETS_KEK_VERSION` as Fly secrets before the first real deploy.
