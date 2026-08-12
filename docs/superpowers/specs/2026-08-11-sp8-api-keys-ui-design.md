# SP8: The API keys UI, design

Date: 2026-08-11
Status: Approved, ready for planning
Depends on: SP7 (merged), ADR 003 as amended

## Purpose

Issue, list and revoke API keys from a browser. The backend has done this since
SP5, and nothing in the UI has ever reached it.

This is the last of the three UI sub-projects and the last numbered
sub-project. It carries the one screen in the application that displays a live
credential on purpose, and the navigation bar that SP6 and SP7 both deferred.

Frontend only. No backend changes.

## Scope

### In scope

- `/keys`, the list, with create and revoke
- The show once token panel, and the guard against losing it
- The navigation bar, in `AppShell`'s existing header
- Removing SP7's stopgap back link from `SecretsPage`
- Extracting `ConfirmPrompt` from `BucketRow` and `SecretRow`

### Explicitly out of scope

Four of these share one reason: no endpoint exists, and inventing one is
backend work this sub-project has no mandate for.

- **Editing a key's scope.** There is no `PATCH`. Changing what a key reaches
  means revoking it and issuing another, which the UI supports as two acts.
- **Deleting a key.** `DELETE /v1/keys/{id}` revokes. It does not remove the
  row, and nothing else does either.
- **Rotating a key in place.** Same absence, same answer.
- **An audit log view.** Rows have been written since SP3 and nothing reads
  them back. That is its own sub-project, not a corner of this one.
- **Zustand.** See A11. Three sub-projects have now each found that the state
  they expected to be global belongs in a component.

## Routes

`/keys` is the third sibling in the hierarchy A7 fixed, alongside `/buckets`
and `/buckets/:name`. It is a child of the same `RequireSession` and `AppShell`
pair, so it inherits the guard rather than repeating it.

### The navigation bar

Two `NavLink`s in `AppShell`'s existing header row, beside the app name, with
the email and Sign out staying on the right. No new layout region.

`NavLink` supplies `isActive`, so current page styling needs no state of our
own and no route matching of our own. That is the entire reason to prefer it
over `Link` here.

### SP7's back link comes out

`SecretsPage` carries an "All buckets" link. SP7's spec named it a stopgap,
in those words, because SP8's navigation bar was not there yet to provide the
way out. It is now, so the stopgap goes rather than lingering as a second
redundant path to the same place.

## The API this consumes

Unchanged since SP5:

```
GET    /v1/keys          list, metadata only
POST   /v1/keys          201, the one response carrying a live credential
DELETE /v1/keys/{id}     revoke, one way
```

`ApiKeyData` carries `id`, `lookup_id`, `name`, `buckets`, `can_write`,
`can_reveal`, `expires_at`, `revoked_at`, `last_used_at` and `created_at`.
`CreatedApiKeyData` is that plus `token`.

**SP8 adds no API client surface.** Create is `POST`, revoke is `DELETE`, list
is `GET`, and all three already exist on `client`. This is the first UI
sub-project to consume the API layer without extending it, which is a fair
sign the layer has settled.

## The show once token

`POST /v1/keys` returns the full `msm_<8 hex>_<43 char>` token exactly once.
Only its SHA-256 is stored, per invariant 6, so the response is the only time
it will ever exist outside the holder's hands.

### The token lives in the mutation's own data

Not copied into `useState`, not written anywhere else. `create.data !==
undefined` **is** the unacknowledged condition, and acknowledging calls
`create.reset()`, which drops it from the `MutationCache`.

One source of truth, and no second copy to forget to clear. It also gives the
memory story for free, the way `gcTime` did for revealed secrets in SP7:
navigating away unmounts the observer and the mutation is collected, so
nothing has to remember to scrub anything.

### The panel replaces the create form

Rather than sitting above it, so a second submit is impossible while a token
is still unsaved.

It carries the key's name, a `tone="warning"` `Alert` stating the token is
shown once and cannot be recovered, the token itself in full selectable text,
a Copy button, and the acknowledge button.

**No mask and no reveal toggle**, which is the opposite of `SecretRow` and
deliberately so. A secret can be revealed again tomorrow. This cannot, so
hiding it would work against the one thing the screen exists to accomplish.

### The loss guard arms on the same condition

One stray click on a navigation link, which this sub-project is itself adding
right next to the panel, or one reload, destroys a credential that cannot be
recovered.

`useBlocker` intercepts in-app route changes and renders our own prompt rather
than a browser dialog, so it is styleable and testable. A `beforeunload`
handler covers reload and tab close.

Both read `create.data !== undefined`. Acknowledging disarms both in one move,
because there is no separate "guard armed" flag that could drift out of step
with what is on screen.

The cost of losing the token is not data loss: the key exists and can be
revoked and reissued. It is that the list would show a key nobody can use,
with no way to tell it apart from one that works.

### Invariant 8 binds hardest here

This is the one screen in the application that displays a live credential by
design. The token reaches no storage, no URL, and no error payload. The
blocker is the only part touching history, and it stores nothing: it asks a
question.

The clipboard is the single permitted exit. That is A10's exception, but A10's
text is written about revealed secrets specifically, and a token is a
different object. A12 names it rather than leaving it inferred.

### Creating invalidates the list

So the new row appears behind the panel. The panel is unaffected, because it
reads mutation state and the list reads query state.

## The scope form

### Two flags, and one of them is easy to mislabel

`may_reveal` is checked only in `list_endpoint`'s bulk path, at
`app/routers/secrets.py:55` and `:149`. The single key `get_endpoint` has no
such check.

**A key with neither flag can still read secret values, one request at a
time**, anywhere in its bucket scope. `can_reveal` buys fetching every secret
in a bucket in one request, which ADR 002 A4 reserves to keys and denies to
every browser session. It does not buy the ability to read.

A checkbox labelled "Reveal secrets" would therefore be a lie, because
unchecking it does not stop the key reading your secrets. The form says what
each flag actually grants, and carries a standing line above both stating that
any key can already read individual secrets in its scope.

`can_write` is create, overwrite **and** delete, as ADR 002 A25 records, and
deleting a secret is unrecoverable because A5 rules out versioning. The label
says so.

Both stay independent checkboxes rather than collapsing into preset roles.
All four combinations are meaningful, and write without bulk reveal is
precisely the scope a deploy pipeline that pushes config but never bulk pulls
should hold.

### Expiry is a preset, never a free datetime

A select: 30 days, 90 days, 1 year, never. The value is computed as
`new Date(Date.now() + days * 86_400_000).toISOString()`, so it is always an
aware UTC instant and always in the future.

This makes two failures structurally unreachable rather than merely handled.
`<input type="datetime-local">` yields `2026-11-09T14:30` with no offset, and
SP5's final review caught a 500 from exactly that shape of value before it
merged, since `datetime | None` accepted the offset-less string and then
compared it against an aware `now`. It is a 422 today, because the fix was
`AwareDatetime`. Separately, the API's own "expires_at is already in the past"
422 cannot be produced by an input that only ever adds to now.

"Never" sends no `expires_at` at all.

### No duplicated pattern, for once

Unlike SP6 and SP7, nothing here copies a regex across the language boundary.
Bucket names come from `useBuckets()` as checkboxes, so nothing is free typed
and `NAME_PATTERN` never crosses.

The only duplicated constraint is the name's 64 character maximum, which is a
number rather than a pattern. Zod covers name (1 to 64), buckets (at least
one), and an expiry preset that is an enum.

### A user with no buckets cannot create a key

The API requires at least one bucket, so the form says so and links to
`/buckets`, rather than rendering an empty checkbox group above a button that
would always fail validation.

## The list

One list, in the API's order, with every key it returns.

Each row shows the name, `msm_<lookup_id>` so a row can be matched against a
token already in hand, the scoped buckets, the capabilities, a status badge,
last used, and created.

The lookup id is safe to display and exists precisely to identify a key
without authenticating as one. It is 32 bits and carries no entropy claim; the
32 random bytes that follow it are the credential.

### Three states, one derived

`revoked_at` set means Revoked. Otherwise `expires_at` in the past means
Expired. Otherwise Active.

Expired is derived at render from the client's clock, so a key expiring while
the page sits open will not flip until something re-renders. Accepted, and
stated here rather than fixed with a timer that would exist to update a badge.

Revoked and expired rows are muted and lose their Revoke button. Nothing is
hidden, because there is no endpoint that deletes a key, so a row filtered out
of this list would be unreachable from the UI permanently.

## The data layer

`src/features/api-keys/useApiKeys.ts`, one flat query root:

```
["api-keys"]     the key list
```

No nesting under `["buckets"]`, for the reason SP7 established: that key
invalidates with `exact: false`.

`useApiKeys()`, `useCreateApiKey()` and `useRevokeApiKey()`, the latter two
invalidating `["api-keys"]` on success.

### One cross-feature edge, and an honest limit on testing it

`api_key_buckets` cascades on bucket delete, so deleting an empty bucket
silently shrinks the scope of any key that named it. `useDeleteBucket` should
therefore invalidate `["api-keys"]` as well.

**No click driven test can falsify that line here.** `/buckets` and `/keys` are
mutually exclusive routes and the list's `staleTime` is 0, so navigating
between them refetches on mount whether or not the invalidation exists. SP7
shipped exactly that shape of test, believing it pinned the equivalent
behaviour, and it did not.

So the line is added, and tested only at the hook level with a direct
`getQueryState(API_KEYS_QUERY_KEY)?.isInvalidated` assertion, with a comment
saying plainly why no walkthrough can prove it. Stating the limit is worth
more than a green test implying coverage it does not have.

## The shared ConfirmPrompt

`BucketRow` and `SecretRow` both carry a two step confirm, and revoke is the
third. That is the threshold that justified extracting `Alert` in SP7.

The extraction covers **only the confirming branch**, which is near identical
in all three: the prompt, the confirm button, the cancel button. Each row
keeps owning its own flag, its own mutation, and its own non confirming
branch, because those differ genuinely. `BucketRow` disables confirm on a
stale `secret_count`, and `SecretRow` sits beside Reveal and Copy.

Taking the whole behaviour instead would land as a render prop API harder to
read than the three plain ternaries it replaced.

The existing `BucketRow` and `SecretRow` tests must pass unchanged through it,
exactly as SP6's and SP7's did through the `Alert` extraction. If one needs an
assertion changed, the extraction altered behaviour and the fix belongs in the
component.

## Errors

Errors surface where the thing that failed is.

| Failure | Where it appears |
|---|---|
| `BUCKET_NOT_FOUND` on create | form level, plus a `["buckets"]` invalidation so the checkboxes correct |
| `VALIDATION_ERROR` on create | form level |
| any other create failure | form level |
| `API_KEY_NOT_FOUND` on revoke | on the row, and the list refetches |
| the list's own failure | a banner beside the list, not replacing it |

The list follows SP6's corrected shape for the reason SP7 did: it renders
whenever `data` exists, so a failed background refetch adds a banner rather
than erasing a loaded list.

## Testing

At the fetch boundary with MSW, through the real router, as SP6's and SP7's
were.

Ordinary coverage: the list renders, an empty account says so, creating adds a
row, revoking marks one revoked, the two step confirm can be cancelled, a user
with no buckets is told to make one first, and each of the three states
renders its badge.

The tests that pin this sub-project, in their own file as SP7's were:

- **After creating, `localStorage` and `sessionStorage` are both empty.**
- **No request URL ever contains `msm_`**, asserted across every request the
  test made rather than one URL, so the guarantee covers code nobody has
  written yet. The same shape as SP7's `reveal` assertion.
- **The blocker blocks.** Clicking a navigation link while unacknowledged does
  not change route; it does after acknowledging. Falsified by removing
  `useBlocker`.
- **`beforeunload` is prevented** while unacknowledged and not after,
  asserted through `event.defaultPrevented` on a dispatched cancelable event.
- **`create.reset()` clears the token from the mutation cache**, asserted on
  the cache rather than on the absence of rendered text, because text can be
  absent for the wrong reason.
- **The expiry preset sends an offset carrying instant in the future**,
  asserted on the request body.
- The existing `BucketRow` and `SecretRow` tests pass unchanged.

## Acceptance criteria

1. `/keys` renders the key list and requires a session.
2. The header carries Buckets and Keys links, and the current one is marked.
3. `SecretsPage` no longer renders its own back link.
4. Creating a key shows the token once, in full, with a copy button.
5. The create form is not reachable while a token is unacknowledged.
6. Navigating away while unacknowledged is blocked and can be cancelled.
7. Reload while unacknowledged triggers the browser's own confirmation.
8. Acknowledging clears the token from the mutation cache and disarms both
   guards.
9. After creating, `localStorage` and `sessionStorage` contain nothing.
10. No request the frontend makes ever contains `msm_`.
11. The scope form states that any key can read individual secrets, and labels
    `can_reveal` as bulk fetch rather than as permission to read.
12. All four combinations of `can_write` and `can_reveal` are reachable.
13. Expiry is chosen from presets, and the request body carries an offset
    carrying instant in the future, or no `expires_at` at all.
14. A user with no buckets is told to create one, and cannot submit.
15. Revoked and expired keys appear, muted, with no Revoke button.
16. Revoking requires the two step confirm and can be cancelled.
17. A failed background refetch of the key list leaves the list on screen.
18. `BucketRow` and `SecretRow` behave identically through the `ConfirmPrompt`
    extraction, with no test assertion changed.
19. `make lint` and `make test` pass, and `make types` produces no diff.
20. No new dependency. Zustand is still not installed, and ADR 003's stack
    table no longer lists it.

## ADR 003 amendments this spec requires

**A11. Zustand is removed from the stack.** A5 named its first consumer as
reveal toggles; A9 corrected that and said if SP8 found no client state
either, it should be removed rather than left waiting indefinitely.

SP8 found none. The token panel is a mutation result plus an acknowledged
flag, revoke confirm is row local, the form is React Hook Form, and navigation
state is `NavLink`'s. Three sub-projects have each concluded that state they
expected to be global belongs in a component.

Amended: the stack table's "Client state: Zustand" row is struck. The frontend
ships v1 with no client state library. TanStack Query owns server state and
`useState` owns the rest.

Worth being exact about what this costs: Zustand was never actually installed,
because A5 deferred it to its first real consumer and that consumer never
arrived. The waste was three sub-projects of planning around a dependency, not
three sub-projects of shipping one. Adding a store later, if a genuine
consumer appears, is a smaller change than this one.

**A12. The show once token is named under A10's clipboard exception.** A10
permits copying a revealed secret to the clipboard, and is written about
revealed secrets specifically. The API key token is a different object and the
only other live credential this UI displays.

Amended: copying the token is permitted on the same terms, and for the same
reason. Nothing clears the clipboard afterwards. The token is otherwise
subject to invariant 8 in full: it reaches no storage, no URL state, and no
error payload, and it exists in memory only as the create mutation's `data`
until `reset()` or garbage collection removes it.

## Risks

**The token is one careless line from persistence.** It lives in a mutation
result, and the difference between that and something durable is a single
`localStorage.setItem` a future contributor might add "so a refresh does not
lose it". The tests assert empty storage after a create, which is invariant 8
checked literally rather than by inspection, and A12 records the rule in prose
so the reasoning survives the code.

**The blocker is a guard whose failure is silent.** If `useBlocker` stops
firing after a React Router upgrade, nothing breaks visibly: the token is just
lost more often. The test falsifies it by removing the hook, which is the only
way to know the assertion means anything.

**`can_reveal` is the most misunderstandable control in the product.** The
form's copy is the only place a user learns that it governs bulk fetch rather
than reading. If that copy drifts, the UI starts lying about a capability
grant. It is worth re-reading whenever the secrets endpoints change.

**The bucket delete cascade is invisible from this UI.** A key's scope can
shrink without the holder ever being told, and the only signal is the bucket
list on a row changing between two page loads. Out of scope to fix here, since
notifying would need backend work, but worth knowing it is a real gap rather
than an oversight.

## Deferred

Nothing to a further numbered sub-project. This is the last one.

Next, unscoped: rate limiting, security headers, the README threat model, and
the KEK rotation CLI.

Later, if the audit trail is ever to be read rather than only written: a log
view, which is the natural first item once v1 ships.

To v2: workspaces and secret versioning, as ADR 002 A5 ruled.
