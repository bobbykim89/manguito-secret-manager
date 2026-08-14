# ADR 003: Frontend architecture

Status: Accepted (amended 2026-08-03)
Date: 2026-08-03

## Context

Existing React experience on the resume is React 16 MERN work, which reads as dated to React-first employers. Primary professional depth is Vue and Nuxt. This project's frontend exists to produce credible, current React evidence.

That goal shapes the stack choice: maximize React-specific practice per hour, rather than re-learning meta-framework patterns already known from Nuxt in a different dialect.

## Stack

| Concern | Choice |
|---|---|
| Framework | React 19 |
| Build | Vite |
| Routing | React Router v7 (declarative mode, SPA) |
| Language | TypeScript, strict |
| Styling | TailwindCSS |
| Server state | TanStack Query |
| Client state | None. See A11. |
| Validation | Zod |
| Forms | React Hook Form with Zod resolver |
| Testing | Vitest, React Testing Library, MSW |

## Rationale

### Why plain React 19 + Vite over Next.js

Next.js is not merely heavier, it is largely inert here. With FastAPI owning the backend, server components, route handlers, and server actions all go unused. The result is a meta-framework where roughly 20% is exercised.

More decisive: coming from Nuxt, file-based routing, SSR hydration, and data-loading conventions are already familiar concepts. Time spent on Next.js is time spent re-learning known patterns in new syntax. A plain SPA concentrates effort on the actual gap: hooks and their dependency semantics, when reconciliation causes problems, why `useEffect` is a footgun, Zustand's store model versus Pinia's.

Existing Nuxt SSR work already demonstrates SSR understanding. This project does not need to prove that again.

Accepted tradeoff: some React job descriptions name Next.js explicitly. If that specific line item becomes important, address it with a separate content-heavy project where SSR earns its place, not this one.

### Why not Remix 3

Remix 3 dropped the React runtime in favor of a forked Preact, with an imperative model (`this.update()` instead of `useState`, native browser events instead of props). A project built on it could not honestly be listed as React experience, which defeats the entire purpose. It is also pre-1.0 with no migration path from Remix 2.

React Router v7 is the actual continuation of the Remix lineage and is genuinely React. That is what this project uses.

### Why TanStack Query

Secret manager UI is almost entirely server state: buckets, secret metadata, API key lists. Hand-rolling fetch plus loading plus error plus invalidation in `useEffect` is the classic React beginner shape and would read as such. TanStack Query is the current idiom and demonstrates knowing where the boundary between server state and client state sits.

Zustand handles the small remainder: which secret rows are currently revealed, modal state, toast queue.

## Type generation across the language boundary

FastAPI emits an OpenAPI schema. `openapi-typescript` compiles it to TypeScript types derived from the Pydantic models.

```
make types
```

regenerates `web/src/api/generated.ts`, which is committed. CI includes a drift check that regenerates and fails on a non-empty `git diff`.

Effect: changing a response shape in Python breaks `tsc` in the frontend. This is end-to-end type safety across Python and TypeScript, and it is one of the more distinctive things about the project. Worth calling out in the README.

## Security-relevant UI requirements

The frontend handles plaintext secrets, so a few behaviors are non-negotiable:

- Secret values are **masked by default**. Revealing requires an explicit click.
- The value is **not fetched until reveal**. The list endpoint returns metadata only, so an unrevealed secret's plaintext never enters the DOM or the JS heap.
- Revealed values auto-mask after a timeout.
- Copy-to-clipboard is available without revealing, since users usually want the value in the clipboard rather than on screen.
- No secret values in `localStorage`, `sessionStorage`, or URL state.
- No secret values in error boundaries, console logs, or any client-side error reporting payload.

## Auth flow

Google OAuth. The frontend redirects to the backend's OAuth initiation endpoint; the backend performs the code exchange and sets a session cookie scoped to `.<domain>`.

Because both `app.<domain>` and `api.<domain>` share an apex, the cookie is same-site and no `SameSite=None` workaround is needed. This is the practical reason for buying a domain rather than living on `vercel.app` plus `fly.dev`.

The frontend never handles Google tokens directly and never stores anything auth-related in JS-accessible storage. The cookie is `HttpOnly`.

## Test plan

Test behavior at the boundary, not implementation details. Mock at the fetch layer with MSW rather than mocking hooks.

Priority cases:

- A secret renders masked on initial load.
- Revealing fires exactly one request.
- The plaintext value is absent from the DOM before reveal.
- Revealed value auto-masks after the timeout.
- API key creation displays the key once and does not re-display it after navigation.
- Error states render for 401, 403, and network failure.

Explicitly not testing: Tailwind classes, component internals, whether a specific hook was called.

## Structure

```
web/src/
├── api/
│   ├── generated.ts        # generated, committed, do not hand-edit
│   └── client.ts           # typed fetch wrapper, credentials: include
├── features/
│   ├── buckets/
│   ├── secrets/
│   └── api-keys/
├── components/             # shared primitives only
├── routes/
└── lib/
```

Feature-first, not type-first. Component, hook, and query for one feature live together.

## Deployment

Vercel Hobby, project root directory set to `web/`, framework preset Vite. `VITE_API_URL` points at `api.<domain>`. Vercel ignores everything outside `web/`.

## Open questions

- Dark mode. Trivial with Tailwind, but adds test surface. Probably yes, low priority. **Resolved: see A13.**
- Whether the API key creation flow should generate the key client-side and send a hash. Would be a nice zero-knowledge touch for that one credential, but complicates nothing else and may be more confusing than valuable. Leaning no. **Resolved — see A3.**
- Command palette for bucket and key search. Good demo material, out of scope for v1.

---

## Amendments — 2026-08-03 (SP1 brainstorming)

### A1. `client.ts` unwraps the response envelope

ADR 002 fixes a `{ok: true, data}` / `{ok: false, error}` response envelope, so
`generated.ts` will describe both arms as a union. Narrowing that union in
components would spread `ok` checks across the entire codebase — the most
likely way this frontend degrades.

**Amended:** `api/client.ts` narrows the union exactly once. It returns `data`
typed as `T` on success and throws a typed `ApiError` carrying `code` and
`message` on failure. TanStack Query hooks and components deal in domain types
and thrown errors, never in envelopes.

### A2. The revealed-secrets store takes no middleware

The security requirements above ban secret values from `localStorage`,
`sessionStorage`, URL state, console, and error payloads — but the
revealed-values Zustand store is the one place plaintext deliberately lives in
client state, and it is not covered by any of those rules.

**Amended:** the revealed-secrets store never receives `devtools` or `persist`
middleware, with an inline comment stating why. The `devtools` middleware would
stream every revealed value into the Redux DevTools extension, which persists
across reloads; `persist` would write them to storage the rules already forbid.

### A3. Open question resolved: API keys are generated server-side

Client-side generation is rejected, and for a sharper reason than "may be
confusing": the server must guarantee the key's entropy and format. Accepting a
client-supplied hash means trusting the client to have used a CSPRNG, and that
is unverifiable from a hash.

### A4. Bulk reveal is never available to the web session

The "not fetched until reveal" rule stands unchanged for the UI. ADR 002 A4
adds a bulk-reveal path for CI, gated on an API key scope that a web session
cannot hold. The two do not conflict, and the frontend must never request
`?reveal=true`.

### A5. SP1 installs a subset of this stack

Zustand, Zod, and React Hook Form are not installed in SP1, which has no client
state and no forms. They arrive with their first real consumer in SP2 and SP3.
Installing them earlier would mean unused dependencies that no test exercises
and that CI cannot verify are correctly wired.

### A6. SPA deep links must be verified against the deployed site

React Router in declarative mode needs a catch-all rewrite to `index.html`, or
direct navigation to a nested route returns 404. Vercel's Vite preset may supply
this automatically; it must be confirmed on the deployed site rather than
assumed, with a `vercel.json` rewrite added if it does not. This class of bug
appears only in production.

### A7. The URL hierarchy

The bucket list is `/buckets`, a bucket is `/buckets/:name`, and API keys are
`/keys`, so the three are siblings rather than one being a child of an
inconsistent parent.

`/` redirects to `/buckets` from inside the session guard rather than being the
list itself. That leaves `/` free for a dashboard that may never exist, and
avoids the inconsistency of a list at `/` whose detail pages live under
`/buckets/:name`.

The redirect uses `replace`, for the same reason the guard's does: without it
the back button bounces between the two.

### A8. The 401 handler covers mutations as well as queries

SP2b installed the `UNAUTHENTICATED` handler on the `QueryCache` only, which
fires for queries and not for mutations, and recorded the gap as safe. That was
correct at the time: its only mutation was sign out, whose endpoint requires no
authentication and is idempotent.

It stops being safe as soon as the UI mutates real data. A user whose cookie
expired would click a button, receive a 401, and go on looking signed in until
some unrelated query happened to notice.

**Amended:** the same handler is installed on a `MutationCache`. A 401 from any
mutation clears the session and the route guard performs the redirect, so there
is still one path out of the application rather than two.

It carries no session-key exclusion. That exclusion exists on the query side
only because the guard reads the session query's own error, and no mutation
writes to that key.

### A9. Zustand does not arrive with reveal toggles

A5 said it would. That was written in SP1, before anyone worked through what
reveal state actually is.

Designing SP7 showed it is ephemeral and component local: leaving a bucket and
returning hides every previously revealed secret, which is the safer default for
a secret manager and means the state never outlives the component tree.
`useState` covers it, and nothing global exists whose purpose is remembering
that a plaintext should be on screen.

SP6 produced the same correction one sub-project earlier, where a planned page
level confirm flag turned out to belong in the row.

**Amended:** reveal state is row local `useState`. Zustand has no scheduled
arrival. If SP8 finds no client state either, remove it from this ADR's stack
rather than leaving it waiting indefinitely for a consumer that keeps not
appearing.

Removing the store did not remove the plaintext it held. SP7 put it in the
TanStack Query cache instead, under the query key
`["secret-value", bucket, keyName]` (see
`web/src/features/secrets/useSecrets.ts`), with `staleTime: Infinity` and the
default five minute `gcTime`. A2's constraint now lives here, not in a store
that no longer exists: the query client (`web/src/api/queryClient.ts`) must
never receive a persister — `persistQueryClient` or
`@tanstack/react-query-persist-client` — since that would write every revealed
value to `localStorage`, exactly what invariant 8 forbids. `secret-value`
entries leave the cache when `gcTime` expires five minutes after the owning
component unmounts, or when a write or delete calls `removeQueries` on that
key directly; there is no explicit "clear revealed secrets" action to audit
instead. No persister may be added to the query client without re-examining
this paragraph first.

### A10. The clipboard is a named exception to invariant 8

Invariant 8 lists `localStorage`, `sessionStorage`, URL state and client side
error reporting. The clipboard is not on that list, and is nonetheless a place a
plaintext secret goes.

**Amended:** copying a revealed secret to the clipboard is permitted, and is the
product's purpose rather than a concession to it.

Nothing clears it afterwards. `navigator.clipboard.writeText("")` only succeeds
while the document has focus, so a timed clear fails precisely when the user has
switched to the application they meant to paste into. A guarantee that does not
hold in its main case is worse than none, and the audit log is the real record
of who read what.

### A11. Zustand is removed from the stack

A5 named its first consumer as reveal toggles. A9 corrected that once SP7
showed reveal state is ephemeral and component local, and said that if SP8
found no client state either, Zustand should be removed rather than left
waiting indefinitely.

SP8 found none. The show once token is a mutation result plus the panel's own
existence, revoke confirm is row local, the form is React Hook Form, and
navigation state is `NavLink`'s. Three sub-projects have now each concluded
that state they expected to be global belongs in a component.

**Amended:** the frontend ships v1 with no client state library. TanStack
Query owns server state and `useState` owns the rest.

Worth being exact about what this cost: Zustand was never actually installed,
because A5 deferred it to a first real consumer that never arrived. The waste
was three sub-projects of planning around a dependency, not of shipping one.
If a genuine consumer appears later, adding a store then is a smaller change
than this removal was.

### A12. The show once token is named under A10's clipboard exception

A10 permits copying a revealed secret to the clipboard, and is written about
revealed secrets specifically. The API key token is a different object and the
only other live credential this UI displays, so inferring that A10 stretches
to cover it would be crediting a rule with work it does not do.

**Amended:** copying the token is permitted on the same terms and for the same
reason. Nothing clears the clipboard afterwards.

The token is otherwise subject to invariant 8 in full. It reaches no storage,
no URL state and no error payload, and it exists in memory only as the create
mutation's `data`, until `reset()` on acknowledgement or garbage collection on
unmount removes it. The panel that displays it also arms the only guards
against losing it, so those cannot outlive the credential they protect.

### A13. Dark mode is resolved

The open question above has stood since this ADR was first written:
"Dark mode. Trivial with Tailwind, but adds test surface. Probably yes,
low priority." CLAUDE.md separately listed dark mode under "Out of scope
for v1," for a different reason: it wasn't planned work, not a rejection.
That line is removed as part of the same decision this amendment records.

**Amended:** dark mode's foundation ships. `web/src/index.css` defines a
selector-based `dark:` variant
(`@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`),
not the framework's default `prefers-color-scheme` media variant, so a
manual toggle can override system preference once one exists.
`ThemeProvider`/`useTheme` (`web/src/components/ThemeProvider.tsx`)
persist a choice to `localStorage` under a `theme` key and fall back to
`prefers-color-scheme` when unset. No page or component calls
`setPreference` yet: there is no toggle control anywhere in the shipped
surface, so a user's only path to dark mode today is matching their OS
preference. The manual toggle is deferred to the login/shell follow-up
piece, the first place a UI control exists to wire it into. This is a UI
preference, not a secret value, so `localStorage` is the ordinary place
for it: invariant 8 restricts secret values specifically.

### A14. Toasts are a scoped exception to A11

A11 removed Zustand and settled on "TanStack Query owns server state and
`useState` owns the rest," reasoning that every piece of state this app
had needed turned out to be component-local. A toast queue does not fit
that shape: it is triggered from wherever a mutation succeeds and rendered
once, high in the tree, so it needs to live somewhere neither its producer
nor its single consumer owns alone.

A11's target was dependence on a state-management package, not React's
own Context, but the distinction was never stated, so this amendment
states it directly rather than leaving it implied.

**Amended:** `ToastProvider` (`web/src/components/ToastProvider.tsx`) is a
React Context wrapping a `useState` list, mounted once above the router.
`useToast()` returns a `notify(message, tone?)` function; nothing else
about A11 changes. This is scoped to toast notifications specifically and
is not a general license for more shared client state. The next piece of
state that looks like it needs to be global should still be checked for
whether it is actually component-local first, the way A9 and this ADR's
own history already show it usually is.

### A15. The theme toggle ships, and the palette is the design system's

A13 recorded that no page or component called `setPreference`, and named
the login and shell piece as where a toggle would arrive. This is that
piece, so that sentence no longer holds.

**Amended:** `AppShell` renders a `ToggleSwitch` labelled "Dark mode" that
calls `setPreference`. It is binary, so the first click moves a user from
`system` to an explicit preference and there is no in-app path back.
`system` remains the default for anyone who never touches it. A three
state control would need a component that does not exist and would leave
`ToggleSwitch` without a consumer until the API keys piece.

**Also amended, and more consequential:** the token values A13 described
were invented. The foundation's plan was written before the mockup's
design system source had been read, and filled the gap with plausible
indigo and slate rather than real values. They compiled cleanly, so
nothing downstream caught it.

The palette is now the Organic design system's own: warm terracotta
(`#c67139`) and olive (`#7a8a5e`) on a cream ground (`#f5ead8`), keyed to
the Manguito lovebird logo, with both accent ramps at 100 through 900 and
Organic's own dark overrides. Inter is kept for headings, buttons and the
brand wordmark, matching the mockup's explicit override of Organic's
heading font, and Figtree is self hosted for body text on the same terms
Inter already was: no runtime request to a font CDN from a page that also
handles Google sign in.

A13 should not be read as evidence that the original values were ever
chosen deliberately. Nothing else in A13 changes.

### A16. Auto-mask and copy-without-reveal are built, and the reveal guard is load-bearing

Two of this ADR's security-relevant UI requirements went unbuilt through SP7
and stayed that way until the secrets reskin: "revealed values auto-mask after
a timeout" and "copy-to-clipboard is available without revealing". The body
also never said how long the timeout was, so the requirement was not
implementable as written.

**Amended:** both are built, on these terms.

Auto-mask is 30 seconds, timed from the plaintext reaching the screen rather
than from the reveal click, so a slow fetch does not consume the window. It is
visual only: the cached value is left in place, so a re-reveal serves the cache
and one visit still produces one `secret.read` audit row. That follows A9,
which established that hiding is an affordance rather than a boundary because
the value is in the tab's memory either way. The threat auto-mask addresses is
an unattended or overlooked screen, which re-masking covers fully. Purging the
cache instead would charge a second audit row for what the user experiences as
one visit, and A9 deliberately avoided exactly that.

Copy without revealing fetches the value imperatively through
`queryClient.fetchQuery` and the shared `secretValueQueryOptions`, rather than
through `useSecretValue`, whose `enabled` flag *is* the reveal. The plaintext
exists on that path only as a local variable handed to `writeText`. It reaches
no DOM node, no toast and no error message, which keeps it inside invariant 8
and under A10's clipboard exception. Because the shared options carry
`staleTime: Infinity`, copying an already revealed value serves the cache and
costs no second audit row.

One consequence is easy to miss and would be a security regression rather than
a cosmetic one. TanStack Query's `enabled: false` prevents fetching, not
reading: once the copy path has populated `["secret-value", bucket, keyName]`,
`useSecretValue` returns that entry for the same row even though `revealed` is
`false`. `SecretRow`'s

```ts
const plaintext = revealed ? value.data?.value : undefined;
```

is the only thing standing between a copy and an unintended reveal. It must not
be simplified to `value.data?.value` on the reasoning that a disabled query has
no data to read.

A14's toast exception is read as permitting success toasts, not mandating them
everywhere. Add, replace and delete raise one; copy keeps its adjacent inline
"Copied" line, because copy is the highest-frequency action on the page and a
toast per copy is noise.
