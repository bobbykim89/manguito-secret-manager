# SP6: The bucket UI, design

Date: 2026-08-11
Status: Approved, ready for planning
Depends on: SP5 (merged), ADR 003 as amended

## Purpose

Make buckets usable from a browser. The API has been complete for v1 since SP5,
but the frontend still shows the placeholder body SP2b shipped: you can sign in
and see your email, and nothing else.

SP6 is the first of three UI sub-projects. It does buckets, and it brings the
shared foundations the other two build on.

Frontend only. No backend changes.

## Why three sub-projects rather than one

The full UI is three feature areas, each comparable in size to SP2b, which was
seven tasks on its own: buckets with create and delete, secrets with the reveal
interaction and a value editor, and API keys with a scope form and a show-once
token. Attempting one spec would produce a plan too large to review honestly,
which is the failure mode the per-task reviews on this project exist to catch.

- **SP6** does buckets and the foundations. Buckets is the smallest resource, so
  the foundations land in the simplest feature rather than tangled with the
  reveal interaction.
- **SP7** does secrets, including reveal, which is where invariants 7 and 8 bite
  hardest and therefore deserves its own review cycle.
- **SP8** does API keys and the navigation bar that becomes worth having once
  there is a second destination.

## Scope

### In scope

- `/buckets`, the list, with create and delete
- `/` redirecting to it
- `AppShell`'s placeholder body becoming an `<Outlet />`
- Zod and React Hook Form arriving with the first real form
- `client.del`
- Closing the mutation 401 gap SP2b left

### Explicitly out of scope

- **Zustand.** ADR 003 A5 names its first real consumer as reveal toggles, which
  is SP7. Nothing in a bucket list needs client state TanStack Query does not
  already own, and reaching for it to hold a modal flag is exactly the
  speculative adoption A5 exists to prevent.
- **The bucket detail route.** SP7 adds `/buckets/:name` together with the
  secrets that give it a reason to exist. No route here opens onto nothing.
- **A navigation bar.** There is one destination. SP8 adds nav when there is
  somewhere to navigate.
- **Toasts.** Errors surface where the thing that failed is. A toast system
  would need the global state this sub-project is deliberately not adding.
- **Optimistic updates.** Invalidate and refetch is correct here and cheaper to
  reason about, and a bucket list is small enough that the refetch is invisible.
- Any backend change.

## Routes

| Route | Access | Contents |
|---|---|---|
| `/login` | public | unchanged |
| `/health` | public | unchanged |
| `/` | protected | `<Navigate to="/buckets" replace />` |
| `/buckets` | protected | the list |
| `*` | public | the existing NotFound |

The redirect is the index child of the existing `RequireSession` layout route,
so it inherits the guard rather than repeating it. `replace` matters for the
same reason it did in SP2b: without it the back button bounces between the two.

`/buckets` rather than `/` for the list, so SP7's `/buckets/:name` and SP8's
`/keys` are siblings of a consistent hierarchy rather than children of an
inconsistent one, and `/` stays free for a dashboard that may never exist.

`AppShell` keeps its header of email and sign out, and its placeholder body
becomes an `<Outlet />`. That is what SP2b's placeholder was waiting for.

## Dependencies

Two arrive, both with a real consumer here: `zod` for the bucket name schema and
`react-hook-form` with `@hookform/resolvers` to wire it in. This is what A5
means by the first real form.

Zustand still waits.

## The data layer

Three hooks in `src/features/buckets/`:

- `useBuckets()`, a query on `GET /v1/buckets` under the key `["buckets"]`
- `useCreateBucket()`, a mutation invalidating that key on success
- `useDeleteBucket()`, the same

`client.ts` gains `del` alongside `get` and `post`, added inside the single
`request` function so it inherits the response envelope narrowing rather than
forking a second path. That is the property SP2b established and every later
call site depends on.

### The mutation 401 gap closes here

`createQueryClient` installs its `UNAUTHENTICATED` handler on the `QueryCache`,
which fires for queries and not for mutations. SP2b recorded this as safe at the
time, because its only mutation was logout, whose endpoint needs no auth. It
stops being safe the moment the UI mutates real data.

`createQueryClient` gains a `MutationCache` whose `onError` clears
`SESSION_QUERY_KEY` on an `UNAUTHENTICATED` `ApiError`, exactly as the query
handler does. It needs no session-key exclusion: that exclusion exists only
because the route guard reads the session query's own error, and no mutation
writes to that key.

Without it, a user whose cookie expired could click Create, receive a 401, and
go on looking signed in until some unrelated query happened to notice.

## The list

`BucketsPage` renders a create form above the list.

Each row shows name, secret count and created date, in the order the API
returns. Rows are not links; SP7 makes them so when there is something behind
them. The empty state says there are no buckets yet rather than pretending the
list is still loading.

The create form sits permanently above the list rather than behind a button.
One text input and a submit is unobtrusive enough, and it means a first-run user
with no buckets sees the thing they need rather than an empty state pointing at
a button that reveals it.

## Creating

The Zod schema is one field:

```ts
name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, message)
```

The message teaches the rule rather than restating the regex, because
lowercase-only is the part people get wrong.

The input and submit are disabled while the mutation is pending, and the form
resets only on success. A failed submit keeps what was typed, because retyping a
name the server rejected for a reason you can now read is pure friction.

### The pattern is duplicated, deliberately and visibly

FastAPI emits the pattern into the OpenAPI schema, but `openapi-typescript`
produces types and a regex is a runtime value, so nothing carries it across the
generated boundary.

It therefore lives in exactly one place on the frontend,
`src/features/buckets/bucketName.ts`, and is tested against the same case table
the backend uses: `prod`, `blog-prod`, `manguito_staging` accepted; `Prod`, a
space, a slash, a leading hyphen, empty, and 64 characters rejected.

If the two ever drift, the server still refuses and the client merely guesses
wrong about when. That is the failure mode worth having rather than its reverse.

## Deleting

Per row, and less dangerous than it first looks: the API refuses a non-empty
bucket with 409, so the catastrophic case is guarded server side. What a
confirmation protects here is an empty bucket, where the loss is a name and a
key with nothing under it.

When `secret_count` is above zero the button is disabled and says why, so the
409 is explained before it can happen rather than discovered through an error.

Clicking Delete swaps that row's actions for "Delete this bucket? Yes / Cancel",
held in one piece of page-local `useState` naming which row is confirming. Not
Zustand: this is one component's state and never leaves it.

**The 409 is still handled**, because `secret_count` comes from the last fetch
and something could have written through the API since. `BUCKET_NOT_EMPTY`
renders on the row, and the list refetches so the count corrects itself.

## Errors

Errors surface where the thing that failed is.

| Failure | Where it appears |
|---|---|
| `BUCKET_EXISTS` | a field error on the name, via React Hook Form's `setError` |
| any other create failure | a form-level message |
| `BUCKET_NOT_EMPTY` | on the row that failed |
| the list's own failure | `role="alert"` |
| pending states | `role="status"` |

`BUCKET_EXISTS` reads like validation because it is validation, just performed
by the only party that can perform it.

The two ARIA roles close a minor SP2b deferred. They cost nothing in fresh code.

## Testing

At the fetch boundary with MSW, through the real router, as SP2b's tests were.

- The list renders what the API returned
- The empty state appears when it returns nothing
- **An invalid name is rejected without a request reaching the network**, which
  is what proves Zod runs before the mutation rather than decorating it
- A valid name creates, and the new bucket appears
- `BUCKET_EXISTS` lands on the name field, not in a generic banner
- Delete is disabled, with its reason shown, when the count is above zero
- The two-step confirm can be cancelled without deleting
- A stale `BUCKET_NOT_EMPTY` renders on the row and the list refetches
- `/` redirects to `/buckets`
- The name schema accepts and rejects the same cases the backend does

### One test needs designing rather than writing

The mutation 401 must prove the new `MutationCache` handler works, which means
**the only 401 in the whole interaction has to come from the mutation.** If a
query is also in flight returning 401, the existing `QueryCache` handler clears
the session and the test passes whether or not the new handler exists.

So: the session query answers 200 throughout, exactly one create or delete
returns 401, and the assertion is that the user lands on `/login`. Verify it by
removing the `MutationCache` and watching it fail.

Nine assertions on this project have looked like they proved something and did
not. This is the shape that produces the tenth.

## Acceptance criteria

1. `/` redirects to `/buckets`, and `/buckets` requires a session.
2. The list shows name, secret count and created date for each bucket.
3. An empty account shows an empty state, not a loading state.
4. A name failing `^[a-z0-9][a-z0-9_-]{0,62}$` is rejected client side with no
   request sent.
5. A valid name creates a bucket and it appears in the list.
6. `BUCKET_EXISTS` appears as a field error on the name.
7. Delete is disabled with a stated reason when `secret_count` is above zero.
8. The two-step confirm can be cancelled without deleting.
9. A `BUCKET_NOT_EMPTY` response renders on its row and the list refetches.
10. A 401 from a mutation clears the session and lands the user on `/login`,
    with no query 401 involved.
11. The frontend name schema accepts and rejects the same cases the backend
    tests use.
12. `make lint` and `make test` pass, and `make types` produces no diff, since
    no Pydantic model changes.
13. `zod`, `react-hook-form` and `@hookform/resolvers` are the only new
    dependencies, and Zustand is not among them.

## ADR 003 amendments this spec requires

**A7. The URL hierarchy.** The bucket list is `/buckets`, a bucket is
`/buckets/:name` in SP7, and API keys are `/keys` in SP8, so the three are
siblings. `/` redirects to `/buckets` inside the session guard rather than being
the list itself, which leaves `/` free for a dashboard that may never exist and
avoids an inconsistency where the list is `/` but a bucket is `/buckets/:name`.

**A8. The 401 handler covers mutations as well as queries.** SP2b installed it
on the `QueryCache` only and recorded the gap as safe, correctly at the time,
because its only mutation was logout, whose endpoint requires no auth. Amended:
the same handler is installed on a `MutationCache`, so a 401 from any mutation
clears the session and the guard redirects. It carries no session-key exclusion,
because that exclusion exists only for the guard reading the session query's own
error and no mutation writes to that key.

## Risks

**The name pattern is duplicated across the language boundary.** Nothing
generates it, and a drift would show up as the client accepting a name the
server then rejects. The mitigation is a single frontend definition tested
against the backend's own case table, not a promise to remember.

**Invariants 7 and 8 barely bind SP6**, because no secret value passes through
it, and they bind SP7 hard. The risk is establishing a pattern here that makes
them awkward later, which mostly means not inventing a global store for server
data that SP7 would then be tempted to put a revealed value into. This spec
avoids that by adding no global store at all.

**The delete confirmation is deliberately light**, on the reasoning that the API
refuses a non-empty bucket. If that guard were ever relaxed, this UI would be
one click away from destroying secrets, so the two are coupled more tightly than
they look.

## Deferred

To SP7: `/buckets/:name`, the secret list, the reveal interaction, and Zustand
with it.

To SP8: API keys, the show-once token, and the navigation bar.

Later: rate limiting, security headers, the README threat model, and the KEK
rotation CLI.

To v2: workspaces and secret versioning, as ADR 002 A5 ruled.
