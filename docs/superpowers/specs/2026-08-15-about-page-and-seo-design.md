# About page and search metadata

**Status:** approved
**Date:** 2026-08-15
**Scope:** `web/index.html`, `web/public/`, a new `web/src/features/about/`,
plus link changes in `AppShell` and `LoginPage`

Two related pieces of work: make the application share and index sensibly,
and add an About page of the kind the maintainer puts on their other
projects.

## The constraint that decides the shape of the metadata

This is a Vite single page application. Every route, `/`, `/about`,
`/buckets`, serves the byte identical `web/index.html`. Social crawlers and
most search bots do not execute JavaScript, so the tags in that one file are
the only tags that exist, for every URL on the site.

There is therefore no per route Open Graph card without adding prerendering
or server rendering. Neither is proposed. The application has exactly two
publicly reachable pages, and a single card describing the product serves
both of them honestly.

A client side meta tag library, `react-helmet-async` or similar, would not
change this. It updates the DOM after the crawler has already read the
response, so it would add a dependency and solve nothing. It is rejected on
those grounds rather than on dependency cost alone.

## What the metadata is

`web/index.html` gains a description, a canonical link, an Open Graph block
and a Twitter card block. About fifteen lines, no dependency.

`og:image` and `og:url` have to be absolute. The production domain is not
settled yet, so hardcoding it would bake a guess into the repository. Vite
substitutes `%VITE_SITE_URL%` in `index.html` at build time from the
environment, so the tags read:

```html
<meta property="og:url" content="%VITE_SITE_URL%/" />
<meta property="og:image" content="%VITE_SITE_URL%/og.png" />
```

`VITE_SITE_URL` is then set once in Vercel, alongside the `VITE_API_URL`
already documented in the deployment runbook. `web/.env.example` gains the
variable and `docs/deployment.md` gains a line about setting it.

**This substitution gates the design and is verified before anything is built
on it.** See "Verification".

## The share image

No suitable image exists. `web/public/logo.webp` is 192 by 192, which most
platforms render as a small thumbnail rather than a card, and which cannot be
scaled up without visible softening.

`web/public/og.png` is generated at 1200 by 630 from the application's own
design tokens: the cream `--color-bg` background, terracotta and olive
ornament circles echoing the login page's brand panel, the real logo, and
Inter for the wordmark. It is rendered by pointing the Playwright install
already present in the scratchpad at a standalone HTML file and screenshotting
it.

The generator is throwaway and stays in the scratchpad. Only the PNG is
committed, with its provenance recorded in the commit message. Committing the
generator would mean committing a script that cannot run without a dependency
this repository deliberately does not have.

## robots.txt, and no sitemap

`web/public/robots.txt` allows the public pages and disallows the
authenticated ones:

```
User-agent: *
Allow: /$
Allow: /about
Allow: /login
Disallow: /buckets
Disallow: /keys
Disallow: /health
```

Crawlers requesting `/buckets` receive `index.html` with a 200, since the
router runs in the browser. Without these rules a secret manager's internal
route names would end up in search indexes, describing pages that render
nothing without a session. The cost of excluding them is zero.

**No `sitemap.xml`.** With two public pages, one linking to the other, a
sitemap earns nothing. It would also have to carry absolute URLs, and files
in `public/` are copied verbatim without environment substitution, so it
could not stay domain agnostic the way the tags can. The `Allow` and
`Disallow` rules need no absolute URLs, so `robots.txt` works unchanged
wherever the application is deployed, which is also why it carries no
`Sitemap:` line.

## The About page

`web/src/features/about/AboutPage.tsx`, registered as a public standalone
route beside `/login` and `/health`: outside `RequireSession` and outside
`AppShell`. Reachable while signed out, which is what makes it worth indexing
at all.

### Layout

Modelled on the maintainer's existing About pages, mapped onto this
application's tokens.

| Reference | Here |
|---|---|
| `bg-light-3 rounded-md drop-shadow-md` card | `rounded-lg border border-border bg-surface p-8 shadow-lg`, matching `Modal` |
| `max-w-screen-lg`, centred, `min-h-[75vh]` | `max-w-[900px]`, centred, `min-h-screen` |
| `flex-col md:flex-row gap-lg items-center` | `flex flex-col items-center gap-8 md:flex-row md:gap-10` |
| `text-dark-3` | inherits `--color-text`; secondary lines use `text-text-muted` |

### The image, and why it differs from the reference

The reference anchors its left column with a large circular photograph, 256
to 384 pixels. `logo.webp` is 192 by 192, so rendering it at that scale would
soften visibly, and worse on a high density display.

The circular frame is kept and the brand colour carries it, with the logo
sitting inside at a size below its native resolution:

```
240px circle, bg-accent-100, border-4 border-border
   └─ logo.webp at 112px, centred
```

Same silhouette as the reference, crisp at any pixel density, and it echoes
the login page's tinted brand panel, which matters now that these two are the
application's only public faces.

### Content

- An `<h1>`, "About Manguito Secret Manager". An `h1` rather than the
  reference's `h2` because this page stands alone and owns its heading.
- A short description: a self hosted secret manager, secrets in buckets,
  encrypted at rest with envelope encryption, reachable through the web UI or
  programmatically with a scoped API key.
- A muted "Maintained by Bobby Kim" line.
- Three icon links, GitHub, LinkedIn and email, reusing the Font Awesome Free
  6.x paths from the reference along with the attribution comment its licence
  requires, and the same destinations.

Three deliberate departures from the reference, recorded so a later reader
does not mistake them for oversights:

- **No version line.** Neither `web/package.json` nor `api/pyproject.toml`
  declares a version, so the line would either hardcode a number that goes
  stale silently or introduce version bookkeeping nobody asked for.
- **The email icon is a plain icon**, like the other two, rather than the
  reference's filled button. The asymmetry reads as an artefact rather than
  an intentional accent.
- **No repository link.** Whether the repository is public is not established,
  and a dead link on a public page is worse than no link.

### Navigation

`AppShell` already renders a footer `<nav aria-label="Footer">` holding
Buckets and Keys. About joins it, which covers signed in users.

`LoginPage` gains a quiet `text-text-muted` link beneath the sign in card, so
the page is reachable while signed out.

The About page's own heading links to `/`. A signed out visitor following it
is correctly bounced to `/login` by `RequireSession`.

## Tests

- `AboutPage.test.tsx`: the heading renders; each external link carries the
  right `href`, `target="_blank"` and `rel="noreferrer"`; each has an
  accessible name; the heading links to `/`.
- `access.test.tsx`: **`/about` renders while signed out, without redirecting
  to `/login`.** This is the assertion the whole public half rests on, and the
  one most likely to regress silently if the route tree is reshuffled later.
- `AppShell.test.tsx` and `LoginPage.test.tsx`: the About link exists in each.

`AboutPage` fetches nothing, so its test needs no MSW handlers, only a router.

## Verification

### The gate

The absolute URL approach rests on Vite substituting `%VITE_SITE_URL%` in
`index.html`. That is a documented Vite feature but has never run in this
repository. **Before any tag depends on it**, run a production build with the
variable set and confirm `dist/index.html` contains the resolved URL rather
than the literal token.

If it does not fire, the fallback is hardcoding the production domain, and
that change is reported rather than made silently. Shipping tags containing a
literal `%VITE_SITE_URL%` would be worse than either option, because the
failure is invisible until someone shares a link.

Remove `web/dist` afterwards.

### Browser checks

Every piece of the five part UI modernization shipped at least one defect that
passing jsdom tests could not see. `web/vite.config.ts` sets
`test: { css: false }` and jsdom performs no layout regardless.

1. The About page in light and dark at 1280px: card, circle and icons legible,
   every token resolving in both themes.
2. The About page at 380px: the `md:flex-row` collapses cleanly and the card
   does not overflow.
3. `og.png` itself, opened and looked at rather than trusted from the script
   that produced it.

## Out of scope

- **Per route `document.title`.** It does nothing for crawlers on a single
  page application, and its only real benefit is telling browser tabs apart.
  Available later as a small hook with no dependency.
- **Prerendering or server rendering.** The only thing it would buy is per
  route Open Graph cards for two public pages.
- **A sitemap.** Reasoning above.
- **Indexing the authenticated routes.** Explicitly excluded by
  `robots.txt`.

## Risks

- **The Vite substitution is the single point of failure** for every absolute
  URL in the metadata, and it fails invisibly. Hence the gate above, run
  before anything is built on it.
- **`og.png` is a binary asset generated by a throwaway script.** If the
  branding changes, regenerating it means rebuilding the generator. The
  provenance goes in the commit message so the next person knows what produced
  it.
- **The About page is the first public route added since the route tree was
  written.** Placing it inside `RequireSession` by mistake would make it
  invisible to crawlers while still looking correct to a signed in developer.
  The `access.test.tsx` assertion exists for exactly that.
