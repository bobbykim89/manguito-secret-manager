# SP7: The secrets UI, design

Date: 2026-08-11
Status: Approved, ready for planning
Depends on: SP6 (merged), ADR 003 as amended

## Purpose

Show a bucket's secrets, and let a person read one. The API has done this since
SP4, and SP6 left bucket rows deliberately inert waiting for somewhere to go.

This is the second of three UI sub-projects. It is the one where CLAUDE.md's
invariants 7 and 8 actually bite, which is why it was given its own review cycle
rather than being folded into the simplest resource.

Frontend only. No backend changes.

## Scope

### In scope

- `/buckets/:name`, the secret list for one bucket
- Bucket rows on `/buckets` becoming links
- The reveal interaction, single key only
- Adding and replacing a secret through one form
- Deleting a secret
- Copy to clipboard
- `client.put`
- A shared `<Alert>` component, the third consumer that justifies extracting one

### Explicitly out of scope

- **Zustand.** See A9 below. Reveal state turned out to be ephemeral and
  component local, so nothing here needs a store.
- **Bulk reveal.** ADR 003 A4: the frontend must never request `?reveal=true`,
  and the backend refuses a session that tries.
- **Editing a key name.** The API has no rename; replacing a key means writing
  the new one and deleting the old, which the UI already supports as two acts.
- API keys, the show-once token, and the navigation bar. SP8.
- Any backend change.

## Routes

`/buckets/:name` joins the hierarchy A7 established, as a sibling of `/buckets`
rather than a child of an inconsistent parent.

Bucket rows on `/buckets` become links. SP6 left them inert on purpose, since a
route that opens onto nothing is worse than a row that does not yet invite a
click.

An unknown bucket name produces a 404 from the API, which the page surfaces as
its own error state rather than falling through to the router's `NotFound`. The
route is real; the resource is not, and those are different failures.

The page is headed by the bucket's name and carries a link back to `/buckets`.
Browser back works, but a page you can only leave with the back button is a page
that feels like a dead end, and SP8's navigation bar is not here yet to provide
the way out.

The add form sits permanently above the list, as `CreateBucketForm` does on
`/buckets`, so an empty bucket shows the thing you need rather than an empty
state pointing at a button. An empty bucket says it has no secrets yet.

### The list follows SP6's corrected shape, not its original one

SP6's final review found that gating a list on `isSuccess` hides a fully loaded
list the moment a background refetch fails, because TanStack Query reports any
refetch failure as an error while still holding the previous data. It was fixed
there to render on `data` existing, with the error as an additional banner.

That fix was flagged specifically because this page was going to copy the file's
shape. It copies the corrected one: the secret list renders whenever `data`
exists, and a failed refetch adds a banner rather than replacing what is already
on screen.

## Query keys

Three keys on two separate roots:

```
["buckets"]                     the bucket list        SP6, unchanged
["secrets", bucket]             one bucket's metadata  new
["secret-value", bucket, key]   one revealed value     new
```

SP6's review flagged that `["buckets"]` invalidates with `exact: false`, so
nesting secrets under it would mean every bucket create or delete wiping every
open secret list. Separate roots make that impossible rather than depending on
someone remembering `exact: true`.

`secret-value` is a separate root from `secrets` for the same reason one level
down: writing `DATABASE_URL` must not discard a cached `STRIPE_KEY` value the
user revealed thirty seconds ago.

### One cross-feature invalidation, easy to miss

Creating or deleting a secret changes that bucket's `secret_count`, and the
bucket list caches it. Without invalidating `["buckets"]` as well, you could
delete a bucket's last secret, navigate back, and still find Delete disabled
because the cached count says one.

So secret writes invalidate both `["secrets", bucket]` and `["buckets"]`.

Deleting a secret also removes its cached value, if one was ever revealed.
Leaving a decrypted plaintext in memory under a key nothing can display again is
pointless, and `removeQueries` on that one key costs a line.

## The reveal interaction

The list renders `SecretData`: key name, created, updated. **No length, ever.**
That is invariant 7's own stated reasoning, that a length narrows the search
space for a password or a token.

Each row is hidden, revealed, or errored.

### The value query

```ts
useQuery({
  queryKey: ["secret-value", bucket, keyName],
  queryFn: () => client.get<SecretValueData>(`/v1/buckets/${bucket}/secrets/${keyName}`),
  enabled: revealed,
  staleTime: Infinity,
})
```

`enabled` is where invariant 7 lives in code. Nothing about rendering the list
can cause a value fetch; only a user's click flips that flag.

`staleTime: Infinity` means hiding and re-revealing serves the cache, so one
visit produces one `secret.read` audit row. Once a value has been revealed it is
in the tab's memory, so hiding is a visual affordance rather than a security
boundary, and a second reveal discloses nothing that was not already disclosed.
Counting clicks would make a misclick indistinguishable from a genuine second
look at a credential.

The cost is accepted and worth stating: if something writes that secret through
the API while the page is open, the user keeps seeing the value they already
fetched until they leave and return.

`gcTime` stays at the five minute default, deliberately. Navigating away
unmounts the observer, and five minutes later the plaintext leaves memory
without anyone writing code to do it.

### Reveal state is ephemeral

Row local `useState`. Leaving the bucket and returning hides everything again.

For a secret manager that is the safer default: walking away and coming back
should not leave plaintext on screen. It also means nothing global exists whose
purpose is remembering that a secret should be visible.

### The mask is a constant

While a secret has never been revealed the client genuinely has no value, so a
length derived mask is impossible by accident. After a reveal and a hide, the
value **is** in the cache, and `"•".repeat(value.length)` is a natural looking
line that would leak exactly what invariant 7 forbids.

A fixed `••••••••` costs nothing and removes the possibility. A test pins it:
two secrets of very different lengths, revealed then hidden, must produce
identical masks.

### Accessible names carry the key name

"Reveal DATABASE_URL", not "Reveal". With twenty rows a bare label is ambiguous
to a screen reader, and it forces every test to reach for indexes or `within()`
gymnastics.

### A failed reveal says nothing

SP4 made decrypt failures a 500 carrying no detail, so the UI has nothing to say
beyond "Could not reveal this secret." The value never enters an error message,
an exception, or a log line, which is invariant 8's client side error reporting
clause applied literally.

## Copy

A copy button beside each revealed value, using `navigator.clipboard.writeText`,
with a brief confirmation.

The clipboard is a deliberate exception to invariant 8's spirit, recorded as A10
rather than left implicit. Putting the secret somewhere the user can paste it is
the entire purpose of the product.

Clipboard clearing after a timeout was considered and rejected: in a browser,
`writeText("")` only succeeds while the document has focus, so switching to the
terminal you meant to paste into is exactly the case where the clear silently
fails. A guarantee that does not hold in its main case is worse than no
guarantee.

Tests get a real clipboard stub from `userEvent.setup()` rather than a hand
mocked global.

## Writing

One form for both creating and replacing, matching the backend's upsert.

The submit button reads **"Add secret"** until the typed key name matches an
existing one, then **"Replace secret"**. The list is already on screen, so the
client knows before submitting rather than after. That removes most of the
silent clobber risk one form costs, without a second flow or a confirm step.

`client.put` is added inside the single `request` function, inheriting the
envelope narrowing rather than forking a second path, the same way `del` was in
SP6.

The value is a textarea, not an input. 64 KiB is PEM keys and service account
JSON, not a password field.

### Two validation rules, one of which is a trap

**Key names** match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. That is deliberately
**not** the bucket rule: uppercase and dots are allowed, because these are
environment variable names. ADR 002 A22 records why the asymmetry exists, so the
frontend copy carries its own case table rather than anyone assuming symmetry
with `bucketName.ts`.

**Values** are at most 64 KiB **of UTF-8, measured in bytes**.
`z.string().max(65536)` is wrong: JavaScript's `.length` counts UTF-16 code
units, so 30,000 characters of `中` passes at 30,000 while weighing 90,000 bytes
and failing at the server. The check is
`new TextEncoder().encode(v).length <= 65536`, with a test case using multi byte
characters specifically.

Both patterns are duplicated from the backend for the reason SP6 recorded: a
regex and a byte count are runtime values, and `openapi-typescript` produces
types. One copy each on this side, tested against the backend's own cases, so a
drift shows up as a failing test rather than silently.

## Deleting

The two step confirm from `BucketRow`, for consistency.

It matters more here. An empty bucket costs a name; a secret is the data. There
is no server side guard equivalent to `BUCKET_NOT_EMPTY` standing behind this
one.

## The shared Alert

This sub-project adds at least two more `role="alert"` paragraphs, which would
make seven near identical blocks across the app. SP6's review said extract
rather than add a sixth and seventh.

A shared `<Alert>` in `web/src/components/` lands here and the existing five are
migrated to it. That directory does not exist yet, correctly, because until now
there was no third consumer to justify one.

## Testing

At the fetch boundary with MSW, through the real router, as SP6's tests were.

Ordinary coverage: the list renders, the empty bucket says so, creating appears
in the list, replacing updates it, deleting removes it, the two step confirm can
be cancelled, an unknown bucket shows an error.

The tests that pin the invariants:

- **Rendering N secrets sends zero single key requests.** Asserted as a request
  count, not as the absence of a rendered value, because a value can be absent
  for the wrong reason.
- **No intercepted request URL contains `reveal`**, asserted across every
  request the test made, so the guarantee covers code nobody has written yet.
- **Reveal fetches once; hide and re-reveal leaves the count at one.**
- **Two secrets of very different lengths, revealed then hidden, produce
  identical masks.**
- **After revealing, `localStorage` and `sessionStorage` are both empty.**
  Invariant 8 asserted literally rather than by inspection.
- **A multi byte value under 65,536 characters but over 64 KiB is rejected
  client side with zero requests.**
- **Deleting a bucket's last secret invalidates the bucket list**, so its Delete
  re-enables.

## Acceptance criteria

1. `/buckets/:name` renders that bucket's secrets and requires a session.
2. Bucket rows on `/buckets` link to their detail page.
3. An unknown bucket name shows an error state on the page, not the router's
   not found page.
4. Rendering the list sends no request to any single key endpoint.
5. No request the frontend makes ever contains `reveal`.
6. Clicking reveal fetches the value once; hiding and revealing again does not
   refetch.
7. Leaving the bucket and returning hides every previously revealed secret.
8. A hidden secret's mask is identical regardless of the value's length.
9. Copy places the revealed value on the clipboard.
10. After a reveal, `localStorage` and `sessionStorage` contain nothing.
11. A key name failing `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` is rejected client
    side with no request sent.
12. A value over 64 KiB **measured in UTF-8 bytes** is rejected client side,
    including one under 65,536 characters.
13. The submit button says "Replace secret" when the typed key already exists.
14. Deleting a secret requires the two step confirm and can be cancelled.
15. Deleting a bucket's last secret re-enables that bucket's Delete on
    `/buckets`.
16. A failed background refetch of the secret list leaves the list on screen and
    adds a banner, rather than replacing it.
17. Deleting a secret removes any cached value for it.
18. `/buckets/:name` carries a link back to `/buckets`.
19. `make lint` and `make test` pass, and `make types` produces no diff.
20. No new dependency, and Zustand is not installed.

## ADR 003 amendments this spec requires

**A9. Zustand does not arrive with reveal toggles.** A5 said it would, written
in SP1 before anyone worked through what reveal state is. Designing SP7 showed
it is ephemeral and component local: leaving a bucket and returning hides
everything, so the state never outlives the component tree and `useState` covers
it. SP6 produced the same correction one sub-project earlier, where a planned
page level confirm flag turned out to belong in the row.

Amended: reveal state is row local `useState`. Zustand has no scheduled arrival.
If SP8 finds no client state either, it should be removed from ADR 003's stack
rather than left waiting indefinitely for a consumer that keeps not appearing.

**A10. The clipboard is a named exception to invariant 8.** Invariant 8 lists
`localStorage`, `sessionStorage`, URL state and client side error reporting. The
clipboard is not on that list and is nonetheless a place a plaintext secret
goes.

Amended: copying a revealed secret to the clipboard is permitted and is the
product's purpose. Nothing clears it afterwards, because
`navigator.clipboard.writeText("")` only succeeds while the document has focus,
so a timed clear fails precisely when the user has switched to the application
they meant to paste into. A guarantee that does not hold in its main case is
worse than none.

## Risks

**The cached value can go stale within a visit.** `staleTime: Infinity` means an
API key writing that secret while the page is open will not be reflected until
the user leaves and returns. Accepted deliberately in exchange for an audit log
that records disclosures rather than clicks. It is the first thing to revisit if
the audit trail ever needs to distinguish repeated looks.

**Two more patterns are duplicated across the language boundary**, the key name
regex and the byte limit. Nothing generates either. The mitigation is one copy
each, tested against the backend's cases, not a promise to remember.

**The mask is one careless line from leaking length.** The test exists for
exactly this, and it is the kind of test that would still pass if someone
weakened it to compare a mask against itself, so it should compare two masks
from two genuinely different value lengths.

## Deferred

To SP8: API keys, the show once token, and the navigation bar that becomes worth
having once there are two destinations.

Later: rate limiting, security headers, the README threat model, and the KEK
rotation CLI.

To v2: workspaces and secret versioning, as ADR 002 A5 ruled.
