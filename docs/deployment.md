# Deploying

API to Fly.io, frontend to Vercel, Postgres on Neon, both behind one apex
domain.

For the Google OAuth client itself, see
[google-oauth-setup.md](google-oauth-setup.md). This document covers
everything around it and says where the OAuth steps slot in.

## A domain is a hard prerequisite, not a preference

You cannot run this on `*.fly.dev` plus `*.vercel.app` and have login work.
It is worth understanding exactly why before spending money, because the
failure is quiet: sign-in appears to succeed and then the app behaves as
though you were never signed in.

`api/app/auth/cookies.py` sets the session cookie with `samesite="lax"`, and
`web/src/api/client.ts` calls the API with `credentials: "include"`. A
`SameSite=Lax` cookie is sent on top level navigations but **not** on
cross-site `fetch`. So with the two halves on unrelated apexes:

1. `/v1/auth/google/start` and the Google callback are real browser
   navigations, so the OAuth round trip completes and `msm_session` is set on
   the API host.
2. The very next call, `GET /v1/auth/me`, is a cross-site `fetch` from the
   Vercel origin. The browser withholds the cookie. The API answers 401.
3. The frontend concludes nobody is signed in, forever. Logout is also a
   cross-site request and never carries the cookie either.

The `domain` attribute cannot bridge this. A response from `fly.dev` may only
set a cookie for its own host or a parent it controls, and both `fly.dev` and
`vercel.app` are on the Public Suffix List, so browsers reject
`domain=.fly.dev` and `domain=.vercel.app` outright. There is no value of
`SESSION_COOKIE_DOMAIN` that spans the two.

The only alternative is editing `cookies.py` to `samesite="none"`, which ADR
002 A3 and ADR 001 deliberately avoided. Buy the domain. ADR 001 budgets it at
about $10/yr and it is the cheapest line in the whole stack.

Once you own `example.com`, the layout is:

| Host | Serves |
|---|---|
| `app.example.com` | Vercel, the frontend |
| `api.example.com` | Fly, the API |
| `.example.com` | the session cookie's scope |

## Order matters

There is a chicken and egg problem: the API's environment variables need the
final hostnames, but you cannot point DNS at services that do not exist yet.
Resolve it by creating both services first, attaching the custom domains, and
only then setting the environment variables that reference them.

## 1. Neon Postgres

1. Create a project at [neon.tech](https://neon.tech), free tier.
2. Copy the **pooled** connection string. It has `-pooler` in the host.
3. Convert the scheme to the driver this project uses. Neon gives you
   `postgresql://...`; the app needs `postgresql+psycopg://...`.

The pooled endpoint is the right one here: `api/app/db.py` already sets
`poolclass=NullPool` precisely because Neon runs PgBouncer, and pooling on top
of it breaks connection accounting.

Keep this string for step 2. Do not commit it anywhere.

## 2. Create the Fly app and set its secrets

Run from the `api/` directory. `fly.toml` lives there, not at the repo root.

```bash
cd api
flyctl auth login
flyctl apps create manguito-secret-manager-api
```

The app name must match `app = "manguito-secret-manager-api"` in `fly.toml`,
or change both together.

Generate a KEK if you do not already have a production one:

```bash
python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
```

Then set every secret in one call, so the app only restarts once:

```bash
flyctl secrets set \
  DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DB?sslmode=require' \
  ENVIRONMENT='production' \
  APP_URL='https://app.example.com' \
  CORS_ORIGINS='https://app.example.com' \
  SESSION_COOKIE_DOMAIN='.example.com' \
  GOOGLE_CLIENT_ID='...' \
  GOOGLE_CLIENT_SECRET='...' \
  GOOGLE_REDIRECT_URI='https://api.example.com/v1/auth/google/callback' \
  SECRETS_KEKS='1:BASE64KEYHERE' \
  SECRETS_KEK_VERSION='1'
```

Four of these are easy to get wrong in ways that fail quietly rather than
loudly:

- **`ENVIRONMENT=production` is not optional.** `config.py` defaults it to
  `"local"`, and `is_production` is what decides whether the session cookie
  gets its `Secure` flag. Omit it and you ship a production cookie without
  `Secure` over HTTPS. Any value outside `local`, `test` and `schema-dump`
  counts as production, so a typo fails safe.
- **`SESSION_COOKIE_DOMAIN` starts with a dot.** `.example.com`, not
  `example.com` and not `app.example.com`. This is what lets the cookie set by
  `api.example.com` be read by `app.example.com`.
- **`CORS_ORIGINS` must be the exact origin, and cannot be `*`.**
  `cors_origin_list` raises on a wildcard on purpose: with
  `allow_credentials=True`, Starlette reflects whatever `Origin` it was sent
  instead of emitting a literal `*`, which would make every site on the
  internet a credentialed one.
- **`GOOGLE_REDIRECT_URI` must match Google's console byte for byte**, and it
  points at the API host, not the app host. The path is
  `/v1/auth/google/callback`.

The app reads all of these at import time via `get_settings()`. There is no
lifespan hook, so a missing or malformed value crashes the process on boot
with a `ConfigurationError` naming the field, never the value.

## 3. First deploy

```bash
cd api
flyctl deploy --remote-only
```

`fly.toml` declares `release_command = "alembic upgrade head"`, so migrations
run against Neon before the new machine takes traffic. Nothing runs migrations
on boot; this release command is the only path.

Check it came up:

```bash
flyctl status
flyctl logs
curl https://manguito-secret-manager-api.fly.dev/v1/health
```

`/v1/health` runs `SELECT 1`, so a 503 `DB_UNAVAILABLE` means the database
string is wrong or Neon is unreachable, not that the app is broken.

## 4. Attach the API's custom domain

```bash
flyctl certs create api.example.com
flyctl certs show api.example.com
```

Add the DNS records it prints at your registrar. Fly will want an `A` record
(and `AAAA` for IPv6) or a `CNAME`, plus an ACME validation record. Wait for
`flyctl certs show` to report the certificate as issued before moving on.

## 5. Turn on automatic API deploys

The CI workflow already contains a `deploy` job that runs
`flyctl deploy --remote-only` on every push to `main`. It is gated on a
`FLY_API_TOKEN` secret being present, which makes it a no-op until you
provision one. That is why nothing has deployed so far.

```bash
flyctl tokens create deploy -x 999999h
```

Add the output to GitHub under **Settings → Secrets and variables → Actions →
New repository secret**, named `FLY_API_TOKEN`.

Two things worth knowing about how that job behaves:

- It only fires when `api/**` changed. A frontend-only or docs-only push
  correctly does not redeploy the API or re-run migrations.
- It runs after the `api`, `web` and `types-drift` jobs pass, so a red build
  never reaches production.

## 6. Vercel, via the dashboard

This is the git-integration path, which is what you want for automatic
deploys on `main`.

1. [vercel.com/new](https://vercel.com/new), import the GitHub repository.
2. **Root Directory: `web`.** This is the one setting that matters most; the
   repo root has no frontend in it.
3. Framework Preset should auto-detect as **Vite**. Build command
   `pnpm build`, output directory `dist`, install command `pnpm install`.
   These match `web/package.json`, so the defaults should be correct.
4. Add two environment variables, for Production (and Preview if you want
   previews to work against the same API):

   ```
   VITE_API_URL  = https://api.example.com
   VITE_SITE_URL = https://app.example.com
   ```

   Both are baked in at build time, so changing either later requires a
   redeploy, not just a restart.

   `VITE_SITE_URL` is the frontend's own origin, not the API's. It fills in
   the canonical link and the Open Graph tags in `index.html`, so getting it
   wrong means every shared link previews against the wrong host.
5. Deploy.

Vercel's git integration then rebuilds on every push to `main` automatically,
and builds a preview deployment for every pull request.

### Attach the frontend domain

In the Vercel project, **Settings → Domains → Add**, enter
`app.example.com`, and add the DNS record Vercel gives you at your registrar.

### Check deep links

The app uses React Router with real nested routes such as `/keys` and
`/buckets/alpha`. Open `https://app.example.com/keys` directly in a fresh tab
and refresh it. If it 404s, the static host is not falling back to
`index.html`. Fix it by adding `web/vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Vercel serves real static assets before applying rewrites, so this does not
shadow the built JS and CSS.

## 7. Google OAuth

Follow [google-oauth-setup.md](google-oauth-setup.md), which covers the
console in detail. The production-specific parts:

- Add `https://api.example.com/v1/auth/google/callback` to **Authorized
  redirect URIs**, keeping the localhost one so local development still works.
  One client can hold both.
- Leave **Authorized JavaScript origins** empty. This flow never calls Google
  from the browser.
- The consent screen has to be **Published**, not in Testing, unless every
  user is on the test list.

The backend never derives the redirect URI from the `Host` header, by design:
deriving it would let anyone who can influence that header influence where
Google sends the user. That is why it is configuration.

## 8. Smoke test

In a private window, so no local session interferes:

1. Open `https://app.example.com`. You should land on the login page.
2. Sign in with Google. You should end up back on the app, signed in.
3. Reload. **You should stay signed in.** If you get bounced to login here,
   the cookie is not crossing between the two hosts: check
   `SESSION_COOKIE_DOMAIN` really is `.example.com` with the leading dot, and
   that `ENVIRONMENT` is set to `production`.
4. Create a bucket, add a secret, reveal it, copy it.
5. Create an API key and exercise it from outside the browser:

   ```bash
   curl -H "Authorization: Bearer msm_..." \
     https://api.example.com/v1/buckets
   ```

6. Refresh on a deep link such as `https://app.example.com/keys`.

## Cost and cold starts

ADR 001 sizes this at roughly $1 to $3/month, and the configuration is built
to keep it there. `min_machines_running = 0` with `auto_stop_machines` means
the Fly machine stops when idle and starts on the next request. Neon's free
tier also suspends an idle database.

The practical consequence is that the first request after a quiet period pays
both wake-ups at once and can take several seconds. That is the intended
trade: ADR 001's stated concern is that "forgetting to tear down a Fly machine
costs about $2", so it optimises for the mistake that actually gets made.

If cold starts become annoying, raising `min_machines_running` to 1 is the
lever, and it is the change that costs real money.

## Rotating a KEK later

`SECRETS_KEKS` is a comma separated list of `version:base64` pairs so a
rotation can keep the retired key available to unwrap rows that still name it.
Add the new version alongside the old, bump `SECRETS_KEK_VERSION`, deploy,
then run the rotation CLI. Do not remove the old key until nothing references
it.
