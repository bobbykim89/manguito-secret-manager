# SP2b: Login screen and authenticated shell, design

Date: 2026-08-06
Status: Approved, ready for planning
Depends on: SP2 (complete, merged), ADR 003 as amended

## Purpose

Make the authentication layer reachable from a browser. SP2 built Google OAuth,
sessions, and four endpoints, all of which currently can only be exercised with
curl or by typing an endpoint into the address bar. SP2b adds the login screen,
the route guard, and a minimal signed-in shell.

Frontend only. No backend changes.

## Scope

### In scope

- `/login`, a public page with the sign-in control and the callback error
  messages
- A route guard protecting everything else, implemented as a layout route
- A minimal authenticated shell: the signed-in email and a sign out button
- `useSession`, `useSignOut`, and a global handler for 401 responses
- Moving the existing health page from `/` to a public `/health`
- Adding `post` to `client.ts`

### Explicitly out of scope

- Buckets, secrets, and anything that manages them. SP3 replaces the shell's
  placeholder body.
- Zustand, Zod, and React Hook Form. SP2b has no client state and no form: the
  sign-in control is a link, not a submit. All three keep waiting for a real
  consumer, as ADR 003 A5 intended.
- Styling beyond what Tailwind gives for free. There is no design system yet
  and inventing one for two screens would be wasted when SP3 arrives.
- Any backend change. SP2's API is fixed.

## Routes

| Route | Access | Contents |
|---|---|---|
| `/login` | public | Sign-in link, plus the error message when the callback bounced |
| `/health` | public | The existing health page, moved off `/` |
| `/` | protected | Shell: header with email and sign out, placeholder body |
| `*` | public | The existing NotFound |

Protection is a **layout route** wrapping `/`, not a check repeated on each
page. SP3 adds bucket routes as children of that layout and inherits the guard
without repeating it.

The health page moves rather than being deleted. It is a useful development
affordance, it already has tests, and putting a database health check behind a
login would defeat its purpose.

## The sign-in control is a link, not a fetch

The control on `/login` is an anchor whose `href` is
`${VITE_API_URL}/v1/auth/google/start`.

It must be a top-level browser navigation. The flow redirects to Google, sets
and reads cookies across that boundary, and comes back to the API's callback
before finally landing on the frontend. A `fetch` would receive an opaque
redirect and silently do nothing, with no error to debug.

This is the single easiest thing to get wrong in SP2b, so it is stated in a
comment in the code as well as here.

`client.ts` already reads `VITE_API_URL`. SP2b exports a small helper from that
module rather than reading the environment variable a second time, so there is
one definition of where the API lives.

## The session layer

Three pieces, each with one job.

### `useSession`

A query on `GET /v1/auth/me` under the key `["session"]`. It distinguishes two
failure modes, and the distinction is the point:

- **401 `UNAUTHENTICATED` means logged out.** This is the expected answer for a
  visitor with no cookie, not an error to display.
- **Any other failure means we do not know.** A network failure or a 500 is a
  genuine error state.

Collapsing those two would produce a loop: the backend is down, the guard reads
the failure as logged out, the user is sent to `/login`, they click sign in,
Google returns them, the callback fails, and they arrive back at `/login`
having learned nothing. A non-401 failure instead renders a "cannot reach the
server" state and stays put.

### The guard

A layout route with three branches:

- pending: a full page loading state
- unauthenticated: `<Navigate to="/login" replace />`
- authenticated: `<Outlet />`

`replace` matters. Without it the back button bounces between the guard and the
login page.

There is an unavoidable moment on first paint where the app does not yet know
who you are, because ADR 003 forbids storing anything auth-related in
JS-accessible storage, so there is no cached hint to skip the check. The brief
loading state is the honest cost of that rule rather than a defect to design
around.

### The global 401 handler

On the `QueryCache`'s `onError`, an `ApiError` carrying code `UNAUTHENTICATED`
clears `["session"]`. It does not navigate.

That is deliberate. The guard already owns redirection, so the handler only has
to answer whether we are still authenticated and let the existing mechanism
react. Calling `router.navigate` from inside a cache callback would bury
navigation somewhere nobody looks and create an import cycle between the router
and the query client.

The handler skips errors whose key is `["session"]`, since the guard reads that
query's error directly and there is no value in clearing a query to tell it
something it just learned.

SP2b has only one authenticated call, so this looks like more machinery than
the sub-project needs. It is built now for the same reason `client.ts` narrows
the envelope exactly once: every SP3 bucket and secret call inherits it, and
retrofitting it later means touching every call site.

## Login screen

A heading, a line of context, and one control. If a session already resolves,
the page redirects to `/`, so a signed-in user never sees a sign-in screen.

### Error codes map to messages, and the raw parameter is never rendered

`?error=` is attacker controllable: anyone can send a victim a link carrying
arbitrary text. React escapes markup so this is not XSS, but rendering the
parameter verbatim turns the login page into a billboard for whatever an
attacker writes, for example a fake support phone number. A lookup table with a
generic fallback removes the possibility.

| Code | Message |
|---|---|
| `CONSENT_DENIED` | Sign in was cancelled. You can try again whenever you're ready. |
| `INVALID_STATE` | That sign in attempt expired. Please start again. |
| `EXCHANGE_FAILED` | We could not complete sign in with Google. Please try again. |
| `EMAIL_NOT_VERIFIED` | Your Google account's email address is not verified. Verify it with Google, then try again. |
| anything else | Sign in did not complete. Please try again. |

These are exactly the four codes `api/app/routers/auth.py` can emit, no more
and no fewer.

`INVALID_STATE` deliberately says "expired" rather than naming CSRF. The
overwhelmingly common cause is a stale tab or a login left sitting past the ten
minute cookie window. Telling an ordinary user they may have been attacked is
alarming and almost always wrong, and telling a real attacker their attempt was
detected helps nobody.

## Shell and sign out

A header carrying the signed-in email and a sign out button, over a body
stating that secret management arrives in the next sub-project.

Sign out is a mutation calling `POST /v1/auth/logout`. On success it clears
`["session"]`, which is the same move the global 401 handler makes, so the
guard performs the redirect in both cases and there is one path out of the
application rather than two.

On failure it shows "Could not sign out. Please try again." and leaves the
session intact. Clearing it locally would tell the user they are signed out
while the server side session is still alive, which is the wrong lie for a
secret manager to tell.

## File structure

```
web/src/
├── api/
│   ├── client.ts          modified: add post, export the API base URL helper
│   └── queryClient.ts     new: the client plus the 401 handler
├── features/
│   ├── auth/
│   │   ├── useSession.ts
│   │   ├── useSignOut.ts
│   │   ├── RequireSession.tsx
│   │   ├── LoginPage.tsx
│   │   └── errorMessages.ts
│   ├── shell/AppShell.tsx
│   └── health/            unchanged, moves to /health in the router
└── routes/router.tsx      modified: four routes, guard wrapping /
```

`errorMessages.ts` is its own module rather than a constant inside
`LoginPage`, because it is the boundary that stops attacker supplied text
reaching the screen. A named module with its own test is harder to bypass by
accident than an inline object.

`main.tsx` stops constructing the `QueryClient` inline and imports it from
`queryClient.ts`, so the client and its error handler are defined together.

## Testing

At the fetch boundary with MSW, per ADR 003. No backend process is required.

**Guard**
- Pending renders the loading state
- A 401 redirects to `/login`
- A success renders the children
- **A 500 renders the error state and does not redirect.** This is the loop
  described above, and this test is what would catch its return.

**Login page**
- Each of the four codes renders its message
- An unknown code renders the fallback and **not** the raw parameter
- No parameter renders no error at all
- The anchor's `href` is the start endpoint
- An authenticated visit redirects to `/`

**Sign out**
- Success clears the session and lands on `/login`
- Failure shows the message and **leaves the session intact**

**Global 401**
- A protected page whose own query returns 401 ends at `/login`, using a query
  that is not `/me`, which is what proves the handler works for anything other
  than the session check itself

**Routing**
- `/health` is reachable while logged out
- `/` is not

## Acceptance criteria

1. Visiting `/` while logged out lands on `/login`.
2. The sign-in anchor points at `${VITE_API_URL}/v1/auth/google/start`.
3. Each of the four callback error codes renders its own message, and an
   unrecognised code renders the fallback without echoing the parameter.
4. After a successful login, `/` renders the shell showing the signed-in email.
5. Sign out returns the user to `/login`, and the session no longer resolves.
6. A failed sign out leaves the user signed in and shows a message.
7. A 401 from a query other than `/me` sends the user to `/login`.
8. A 500 from `/me` renders an error state rather than redirecting.
9. `/health` is reachable while logged out.
10. `make lint` and `make test` pass, and `make types` produces no diff, since
    no Pydantic model changes.
11. No new runtime dependency is added.

## Risks

**The first-paint loading state is visible on every page load**, because the
session cannot be known without a round trip and nothing may be cached in JS
storage. If it reads as a flash, the fix is presentation, not caching: keep the
loading state visually quiet rather than a large spinner.

**The sign-in anchor cannot be tested end to end here.** A test can assert the
`href`, but nothing in this suite proves the redirect chain works, because that
requires a real browser, a real Google client, and network access. It is
verified by hand using the guide in `docs/google-oauth-setup.md`. Acceptance
criterion 4 therefore depends on a manual check.

**`VITE_API_URL` must be set for the anchor to point anywhere useful.** It
already is in `web/.env.example`, but an empty value produces a relative link
that silently targets the frontend host, which would 404 rather than fail
loudly.

## Deferred

To SP3: buckets, secrets, envelope encryption, API keys, and the shell body
that replaces the placeholder. Zustand arrives with reveal toggles, Zod and
React Hook Form with the first real form.
