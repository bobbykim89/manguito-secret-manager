# SP2: Authentication (backend), design

Date: 2026-08-04
Status: Approved, ready for planning
Depends on: SP1 (complete, merged), ADR 002 and ADR 003 as amended

## Purpose

Establish who a request belongs to. SP2 adds Google OAuth login, server-side
sessions, the `users` and `sessions` tables, and the `current_user` dependency
that every bucket route in SP3 will hang off.

Backend only. The login screen is deferred.

## Scope

### In scope

- `GET /v1/auth/google/start`, `GET /v1/auth/google/callback`,
  `POST /v1/auth/logout`, `GET /v1/auth/me`
- `users` and `sessions` tables, Alembic revision `0002` stacking on the empty
  `0001` baseline
- The `current_user` dependency
- `GoogleOAuthClient` protocol with an Authlib implementation and a test fake

### Explicitly out of scope

- **API keys.** Moved to SP3. ADR 002 defines a key's `scopes` as a list of
  bucket ids, and buckets arrive in SP3, so a key issued here would scope to
  nothing and authorize nothing. Building them beside the buckets they scope to
  means `scopes` can be validated against real ids.
- **The login UI.** A later sub-project.
- Buckets, cryptography, `SECRETS_KEK`, audit logging, rate limiting.
- `/v1/health` stays public. Nothing else exists to protect.

## Decisions made in this spec

These are not in any ADR. They are recorded as ADR 002 amendments alongside
this spec.

**Registration is open.** Anyone with a Google account may sign in and gets an
account on first login. The cost is unbounded accounts on a public instance;
the benefit is that a reviewer can actually try the deployed system. The
consequence that matters: cross-user isolation stops being theoretical, so
ADR 002's rule that cross-user access returns 404 rather than 403 becomes the
most important behavior in SP3.

**Google's `sub` is the identity, not email.** `sub` is stable and unique
forever; email addresses change and can be reassigned. `users.google_sub`
carries the unique constraint and `email` is a mutable attribute refreshed on
each login.

**`email_verified` is checked.** With open registration, accepting an
unverified address would let someone claim an email they do not control.

**Session tokens are stored hashed.** SHA-256, matching the reasoning ADR 002
already applies to API keys: a 256 bit random token has no brute force surface,
so a slow KDF is pure per-request latency, and hashing means a stolen database
dump does not hand over live sessions.

**Sessions expire absolutely after 7 days, with no sliding renewal.**
`expires_at` is set at login and never moved. One column, no write on every
authenticated request, and no way for a stolen session to renew itself
indefinitely. `NullPool` opens a fresh connection per request, so avoiding a
per-request write is worth something. Sliding expiry can be added later without
a migration.

**The OAuth `state` and PKCE verifier live in a short-lived cookie.** No ADR
mentions CSRF protection on the OAuth flow at all. Without `state`, the
callback accepts any code an attacker can make a victim's browser submit, which
is login CSRF: the victim silently ends up authenticated as the attacker and
puts their secrets in the attacker's account.

A cookie rather than a table or process memory. Process memory is genuinely
broken here, because `min_machines_running = 0` means Fly can stop the machine
between the redirect and the callback, failing logins intermittently. A table
would mean rows that live about sixty seconds plus a cleanup job.

**Authlib** for the code exchange and ID token verification, plus `httpx`.
The backend has no HTTP client yet, so something is added either way. PKCE,
JWKS fetching and caching, and JWT signature verification are the wrong things
to hand write in a project whose selling point is security judgment.

## Endpoints

| Endpoint | Purpose | Response style |
|---|---|---|
| `GET /v1/auth/google/start` | Set state cookie, redirect to Google | Redirect |
| `GET /v1/auth/google/callback` | Exchange code, upsert user, create session | Redirect |
| `POST /v1/auth/logout` | Delete session row, clear cookie | Envelope |
| `GET /v1/auth/me` | Current user, or 401 | Envelope |

### One deliberate exception to the envelope rule

SP1's final fix wave made every error path render the ADR 002 envelope.
`start` and `callback` break that on purpose: they are browser navigation
endpoints, not API calls. A user whose consent screen fails should not be
looking at `{"ok": false, ...}` in their address bar. Both redirect to
`<APP_URL>/login?error=<CODE>` on failure.

The rule, which belongs in a comment on the auth router: **endpoints a browser
navigates to redirect; endpoints JavaScript calls return the envelope.**
Without it written down this reads as an oversight later.

## Data model

Alembic revision `0002`, `down_revision = "0001"`. SQLAlchemy 2.x
`Mapped` / `mapped_column` style per CLAUDE.md.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()`. Non-sequential, so ids leak no user count |
| `google_sub` | `text` unique not null | The identity |
| `email` | `text` not null | Mutable, refreshed each login |
| `name` | `text` null | Google does not always return it |
| `created_at` | `timestamptz` not null | |
| `updated_at` | `timestamptz` not null | |

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | Surrogate, so nothing foreign keys to credential material |
| `token_hash` | `bytea` unique indexed | SHA-256 of the token. The token is never stored |
| `user_id` | `UUID` FK to `users.id` | `ON DELETE CASCADE` |
| `created_at` | `timestamptz` not null | |
| `expires_at` | `timestamptz` not null, indexed | |

Deliberately absent: `avatar_url`, `user_agent`, `ip`, `last_seen_at`. Nothing
in SP2 reads them and each is one nullable column to add when something does.
Also absent is any Google refresh token: Google establishes identity once and
is never called again, so storing one would be a liability with no consumer.

## Cookies

Both `HttpOnly` and `SameSite=Lax`.

**`msm_session`** carries the session token. `Domain=.<domain>` and `Secure` in
production, both off locally, because `Secure` cookies are dropped over plain
`http://localhost`. Environment-dependent, and therefore tested: getting it
wrong means login works in development and fails only in production.

**`msm_oauth`** carries the state value and the PKCE verifier.
`Path=/v1/auth`, ten minute max age, cleared on every exit path from the
callback including failures, so a stale verifier never lingers.

### Why the state cookie is not signed

The protection is a double submit comparison, not integrity. `state` binds the
callback to the browser that began the flow: an attacker who starts their own
flow and lures a victim to `/callback?code=...&state=S` fails because the
victim's browser holds no cookie containing `S`. Signing would prevent
tampering, but tampering gains an attacker nothing, since they would still need
a Google authorization matching the value they chose. It would also mean
another dependency for no security gain.

## The callback, step by step

Order matters because each failure is distinct and gets its own code.

1. Google returned `error=access_denied` → `?error=CONSENT_DENIED`
2. `state` param missing, cookie missing, or mismatched → `?error=INVALID_STATE`
3. Exchange the code, sending the PKCE verifier. Rejected or Google unreachable
   → `?error=EXCHANGE_FAILED`
4. Verify the ID token, read `sub`, `email`, `email_verified`, `name`
5. `email_verified` false → `?error=EMAIL_NOT_VERIFIED`
6. Upsert on `google_sub`: insert on first login, refresh `email` and `name`
   otherwise
7. Delete that user's expired sessions, generate 32 random bytes, insert the
   session with `expires_at = now() + 7 days`, set `msm_session`, clear
   `msm_oauth`
8. Redirect to `APP_URL`

## Sessions and the auth dependency

`current_user` reads `msm_session`, hashes it, joins `sessions` to `users`, and
checks `expires_at > now()`. Missing, unknown, and expired all raise the same
`ApiError("UNAUTHENTICATED", 401)` with identical responses, so the endpoint
never reveals whether a token existed.

This is the seam every SP3 bucket route depends on, which is why it is designed
once, here, rather than emerging.

`logout` deletes the row by token hash and clears the cookie. It succeeds even
when nothing matched: idempotent, and it does not answer whether the session
was real.

Expired rows are deleted for that user at login. A
`DELETE WHERE user_id = ? AND expires_at < now()` costs nothing at this scale
and needs no scheduler, which matters because Fly stops the machine when idle
and there is no always-on process to run a sweep. Expiry is enforced by the
lookup query regardless; the delete is only housekeeping.

## The Google boundary

The Google interaction sits behind a protocol, deliberately mirroring ADR 002's
`KeyProvider` pattern:

```python
class GoogleOAuthClient(Protocol):
    def authorization_url(self, state: str, code_challenge: str) -> str: ...
    def exchange_code(self, code: str, verifier: str) -> GoogleIdentity: ...
```

`GoogleIdentity` is a frozen dataclass carrying `sub`, `email`,
`email_verified`, and `name`. `AuthlibGoogleClient` is the production
implementation; tests inject a fake through `dependency_overrides`. No network
in the suite, no recorded fixtures to rot, and every failure mode above becomes
trivially reachable.

## Configuration

New `Settings` fields, all failing fast at import the way `DATABASE_URL`
already does:

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact match registered with Google |
| `APP_URL` | Where the callback sends the browser |
| `SESSION_COOKIE_DOMAIN` | `.<domain>` in production, empty locally |

`GOOGLE_REDIRECT_URI` is configuration rather than something derived from the
request `Host` header. Deriving it is how open redirect bugs start.

### Local development

Google permits multiple exact match redirect URIs on one client and allows
plain `http` for `localhost` specifically, so register both
`http://localhost:8000/v1/auth/google/callback` and the production URI on the
same client. No tunnel and no self signed certificate.

`SECRETS_KEK` still does not appear anywhere. It arrives in SP3.

## Logging

The session token, the Google client secret, and the PKCE verifier are never
logged, per CLAUDE.md invariant 1. The structured logging allowlist covers this,
and the unhandled exception handler SP1 added already returns a fixed message
rather than exception text.

## Testing

Real Postgres through the existing testcontainers fixture. No network.

**Flow**
- First login creates a user and a session
- Second login reuses the user and refreshes a changed email
- Five failure conditions map to four codes: denied consent
  (`CONSENT_DENIED`), a missing state cookie and a mismatched state (both
  `INVALID_STATE`), an exchange Google rejects and an exchange that cannot
  reach Google (both `EXCHANGE_FAILED`), and `email_verified: false`
  (`EMAIL_NOT_VERIFIED`). All five conditions get a test; the two pairs are
  expected to share a code, deliberately, because the client can act on
  neither distinction
- `msm_oauth` is cleared on every failure path, not only on success

**Session**
- `/v1/auth/me` with no cookie, an unknown token, and an expired session return
  an identical 401 envelope
- Logout deletes the row, and a second logout still succeeds
- Login deletes that user's expired rows and leaves other users' rows untouched

**Cookies**
- `Secure` is set when `ENVIRONMENT=production` and unset locally, asserted
  directly on the `Set-Cookie` header

**Isolation**
- A session token belonging to one user never resolves to another

## Acceptance criteria

1. A first-time Google login creates exactly one `users` row and one `sessions`
   row, and sets `msm_session`.
2. A second login by the same Google account creates no new user and updates a
   changed email.
3. All five callback failure conditions redirect to `APP_URL/login` carrying one
   of the four error codes, and every one of them clears `msm_oauth`.
4. `/v1/auth/me` returns the current user with a valid cookie and an identical
   401 envelope for missing, unknown, and expired tokens.
5. Logout deletes the session row and is idempotent.
6. `Secure` appears on `msm_session` under `ENVIRONMENT=production` and does not
   locally.
7. No test performs network I/O.
8. `make lint` and `make test` pass; mypy strict covers the new modules.
9. The plaintext session token appears in no log line and in no response body
   other than the `Set-Cookie` header.

## Risks

**Cookie flags are the likeliest production-only failure.** `Secure` and
`Domain` differ between environments and neither is exercised by a local run.
Criterion 6 exists specifically to catch this in CI rather than after deploy.

**The redirect URI must match Google's registration exactly**, including scheme
and trailing slash. A mismatch fails at Google with an error the application
never sees, so it cannot be handled gracefully. Worth verifying against the
console entry before debugging anything else.

**Open registration means the `users` table grows without bound.** Nothing in
SP2 limits it. Rate limiting is SP4; if the deployed instance attracts
attention before then, the mitigation is closing registration to an allowlist,
which is a config change against the design above rather than a schema change.

## Deferred

To SP2b: the login screen, the error rendering for the five redirect codes, and
the authenticated shell. To SP3: API keys with the prefix ADR 002 A6 requires,
buckets, secrets, and envelope encryption. To SP4: audit logging, rate limiting,
and security headers.
