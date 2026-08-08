# Setting up Google OAuth

How to get the four Google values this project needs, from nothing to a working
local login. Roughly ten minutes.

For what each variable does once you have it, see the environment variable
table in the README. This document is the procedure for obtaining them.

## Does it cost anything

No, and no billing account is required.

Creating a Google Cloud project, configuring the consent screen, and issuing
OAuth client credentials are all free. Google charges for other Cloud services,
but the OAuth 2.0 and OpenID Connect sign-in flow has no per-login or per-user
fee. You will not be asked for a card.

One consequence of a design decision worth knowing: this project requests only
`openid`, `email`, and `profile`. Those are Google's **non-sensitive** scopes,
so the app never needs security verification. Apps that request Gmail or Drive
access do, which is a review process measured in weeks and, for some scopes, a
paid third party security assessment. Keeping the scope list minimal avoids all
of that.

## Before you start

You need a Google account. A personal `@gmail.com` address is fine.

Google reorganizes this part of the Cloud console periodically, so the sections
below may appear under **APIs and Services** or under **Google Auth Platform**
depending on when you read this. The names of the things you are creating are
stable even when the navigation is not.

## 1. Create a project

Go to [console.cloud.google.com](https://console.cloud.google.com) and create a
project. Any name works; it is only a container for the credentials. Ignore
anything prompting for billing.

## 2. Configure the consent screen

This is the screen a user sees when Google asks whether they want to sign in to
your app.

- **User type: External.** Internal requires a Google Workspace organization,
  which a personal account does not have.
- Fill in an app name, a user support email, and a developer contact email.
  Your own address is fine for both. These three fields are the only required
  ones.

## 3. Publish the app

This step is easy to skip and it will bite you later.

A newly created consent screen sits in **Testing** status. In Testing, only
Google accounts you explicitly add as test users can sign in, up to a maximum
of 100. Everyone else is rejected by Google before your application sees the
request, so nothing in this codebase can produce a useful error for it.

This project uses open registration: any Google account may sign in and gets an
account on first login. That requires **Production** status.

Because the app requests only non-sensitive scopes, publishing takes effect
immediately. There is no review, no queue, and no "unverified app" warning
screen for users.

If you would rather keep it closed while developing, leaving it in Testing and
adding your own address as a test user works fine. Just remember this is why
someone else's account gets rejected later.

## 4. Create the OAuth client

Create an **OAuth client ID** of type **Web application**.

**Authorized redirect URIs.** Add exactly this for local development:

```
http://localhost:8000/v1/auth/google/callback
```

Add the production one too if you already have a domain:

```
https://api.<domain>/v1/auth/google/callback
```

One client can hold both, so you do not need a separate client per
environment.

**Authorized JavaScript origins.** Leave empty. The backend performs the code
exchange server side and the browser never talks to Google's JavaScript SDK.

Two things about redirect URIs that cause most of the pain here:

- **The match is exact.** Scheme, host, port, path, and the absence of a
  trailing slash all matter. A mismatch fails at Google, before the request
  reaches this application, so no error handling here can improve the message
  you get.
- **Plain `http` is allowed for `localhost` specifically.** Google makes this
  exception precisely so local development does not need a tunnel or a self
  signed certificate.

## 5. Fill in .env

Copy the client id and secret into the `.env` at the repository root. Only the
first two lines change; the rest are already correct for local development.

```bash
GOOGLE_CLIENT_ID=<the client id>
GOOGLE_CLIENT_SECRET=<the client secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/v1/auth/google/callback
APP_URL=http://localhost:5173
SESSION_COOKIE_DOMAIN=
```

`.env` is gitignored. The client secret is a real credential: keep it out of
commits, screenshots, and issue reports.

## 6. Try it

```bash
make dev
```

Then open **http://localhost:8000/v1/auth/google/start** in a browser. Use a
browser rather than curl; the whole flow is a redirect chain that needs cookie
handling.

You should reach Google's account chooser, consent, and return to `APP_URL`.

Until the login screen lands in a later sub-project, the return lands on the
frontend's "Page not found" screen. That is expected and not a failure. The
session cookie is set regardless.

To confirm, open **http://localhost:8000/v1/auth/me** in the same browser:

```json
{"ok":true,"data":{"id":"...","email":"you@example.com","name":"Your Name"}}
```

Cookies ignore port numbers, so the cookie set during the callback is sent to
both `localhost:8000` and `localhost:5173`.

## When it does not work

A failed callback redirects to `<APP_URL>/login?error=<CODE>` rather than
rendering JSON, because a browser navigates to it directly. The code in that
query string tells you which step failed.

| What you see | What it means | What to do |
|---|---|---|
| Google's own `redirect_uri_mismatch` error, before returning to your app | The URI in `GOOGLE_REDIRECT_URI` is not registered on the client, or differs by a character | Compare both strings literally. Watch for `http` versus `https`, a missing port, and trailing slashes |
| Google says access is blocked or the app is being tested | The consent screen is still in Testing and your account is not a listed test user | Publish the app, or add the account as a test user |
| `?error=CONSENT_DENIED` | You clicked cancel on Google's consent screen | Nothing is wrong. Try again and accept |
| `?error=INVALID_STATE` | The browser did not send back the short lived state cookie, or it did not match | Usually a stale tab, or a login started more than ten minutes ago. Start again from `/v1/auth/google/start`. If it persists, check that cookies are not blocked for `localhost` |
| `?error=EXCHANGE_FAILED` | Google rejected the code exchange, was unreachable, or returned a token that failed verification | Check `GOOGLE_CLIENT_SECRET` first: a wrong secret produces exactly this. Also check that the machine can reach `oauth2.googleapis.com` |
| `?error=EMAIL_NOT_VERIFIED` | Google reported the account's email as unverified | Rare on normal Google accounts. Verify the address with Google, or use a different account |
| A pydantic `ValidationError` at startup, before anything serves | One of the required variables is missing from `.env` | `Settings` validates at import, so this fails fast rather than surfacing as a 500 on first login |

## Going to production

Three things change, and none of them are code:

1. **Add the production redirect URI** to the same client:
   `https://api.<domain>/v1/auth/google/callback`.
2. **Set the secrets on the host.** All seven variables below must exist
   before the first deploy. They are required and validate at import, so a
   deployment missing one fails during the Fly release command, before
   migrations run.

   `SECRETS_KEKS` and `SECRETS_KEK_VERSION` are the envelope encryption
   keys: a KEK wraps each bucket's data key. Generate one with the
   one-liner from `.env.example`:

   ```bash
   python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
   ```

   `SECRETS_KEKS` is a comma separated list of `version:base64` pairs, and
   `SECRETS_KEK_VERSION` names which of those versions new buckets wrap
   their data key with. Keeping a retired version's entry in `SECRETS_KEKS`
   after rotating `SECRETS_KEK_VERSION` forward is what lets rows wrapped
   under the old key still be unwrapped.

   ```bash
   fly secrets set \
     GOOGLE_CLIENT_ID='...' \
     GOOGLE_CLIENT_SECRET='...' \
     GOOGLE_REDIRECT_URI='https://api.<domain>/v1/auth/google/callback' \
     APP_URL='https://app.<domain>' \
     SESSION_COOKIE_DOMAIN='.<domain>' \
     SECRETS_KEKS='1:<base64 output above>' \
     SECRETS_KEK_VERSION='1'
   ```
3. **Set `SESSION_COOKIE_DOMAIN` to `.<domain>`**, so the session cookie is
   shared between `app.<domain>` and `api.<domain>`. Leaving it empty means the
   cookie is scoped to the API host alone and the frontend never sees a logged
   in user.

## Why the redirect URI is configuration

`GOOGLE_REDIRECT_URI` is read from the environment rather than derived from the
request's `Host` header. Deriving it would mean an attacker who can influence
that header can influence where Google sends the user after authenticating,
which is how open redirect bugs start. The cost is one more variable to set per
environment.

The OAuth `state` value and PKCE verifier are held in a separate short lived
cookie that is deliberately not scoped to the parent domain, since only the API
host ever reads it. See ADR 002 amendment A10 for the reasoning.
