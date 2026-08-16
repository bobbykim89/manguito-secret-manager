# App shell: a theme toggle indicator and a mobile menu

**Status:** approved
**Date:** 2026-08-16
**Scope:** `web/src/features/shell/AppShell.tsx` and its test file

Two complaints about the signed in shell, both from using the deployed app:

1. The dark mode switch has no indicator, so it is not obvious what it does.
2. The header does not hold up on a phone.

## What is not touched, and why that matters

`ToggleSwitch` is shared. Besides the theme switch it renders the "Write
secrets" and "Bulk reveal" capability flags in the new API key dialog, wired
through React Hook Form's `Controller`.

Putting sun and moon icons inside `ToggleSwitch` would leak theme semantics
into a control that also represents API key capabilities. Its own docstring
already settles the question: "nothing here renders visible text, so a caller
that wants a visible label wraps this itself." The icons therefore live at the
`AppShell` call site and the component is not modified.

That also means `CreateKeyFlow` is unaffected and needs no re-verification.

## The toggle indicator

A sun before the switch and a moon after it, in a `flex items-center gap-2`
group:

```
[sun]  ( ---o )  [moon]
```

Both icons carry `aria-hidden="true"`. The switch already has `role="switch"`,
`aria-checked` and `aria-label="Dark mode"`, so a screen reader announces "Dark
mode, switch, on" and the icons would be noise. They exist for sighted users,
which is the gap being closed.

The active side takes `text-accent` and the inactive `text-text-muted`, so the
sun is terracotta in light mode and the moon in dark mode. The control then
communicates its state twice, by knob position and by colour, rather than
relying on position alone. Both tokens carry dark mode values, so this stays
inside the rule that only the 100 and 800 ramp steps do.

Icons are `h-4 w-4`, smaller than the About page's `h-7` social icons, because
these flank a 24px switch rather than standing alone.

**A departure from precedent, named so it is not mistaken for an oversight.**
The About page inlines Font Awesome Free paths with the attribution comment its
licence requires. These two are drawn inline as plain geometry instead: a
circle with eight rays, and a crescent from two arcs. GitHub and LinkedIn are
brand glyphs where the official shape is the point and attribution is
obligatory. A sun and a moon are generic forms where matching stroke weight to
this design is better and no attribution obligation arises. Neither approach
adds a dependency.

The existing comment explaining why the label reads "Dark mode" rather than
"Toggle dark mode" stays.

## The mobile menu

### One set of controls, not two

The obvious approach is separate desktop and mobile markup with CSS hiding
whichever does not apply. That would put two Sign out buttons, two theme
switches and two sets of nav links in the DOM at once. It duplicates
interactive controls in the accessibility tree, and it immediately breaks the
existing tests, because `within(header).getByRole("link", { name: "Buckets" })`
would match two elements and throw.

So the controls stay single and only their layout changes.

A useful consequence: Tailwind's `hidden` is CSS, and `web/vite.config.ts` sets
`test: { css: false }`, so jsdom never applies it. Every element stays in the
DOM whatever the menu state, and **11 of the 12 existing `AppShell` tests pass
untouched**. The disclosure is tested through `aria-expanded`, which is real
state rather than styling, and is the right thing to assert regardless.

### Layout, without moving anything on desktop

The nav links belong in the mobile menu but sit beside the brand on desktop,
while the account controls sit far right. One element cannot occupy two
positions. Flex wrap ordering resolves it without duplication:

| Element | Classes | Effect |
|---|---|---|
| brand | auto width | first, always visible |
| hamburger | `ml-auto md:hidden` | right of brand on mobile only |
| nav | `w-full md:w-auto` | own row on mobile, inline on desktop |
| account | `w-full md:w-auto md:ml-auto` | own row on mobile, pushed right on desktop |

Desktop renders brand, then nav immediately after it, then the account group
pushed right by `md:ml-auto`. That is **today's layout exactly**. The request
was to fix mobile, not to change desktop, and this keeps that promise.

Mobile puts brand and hamburger on the first row, with nav and account each
wrapping to a full width row beneath when open.

Because two elements collapse rather than one, the button carries
`aria-controls="shell-nav shell-account"`. Space separated ID lists are valid
ARIA, and this beats introducing a wrapper that would force the nav to the
right on desktop.

### Behaviour

- `aria-expanded` on the button, reflecting state
- `aria-label="Menu"`, with the icon swapping between a hamburger and an X
- Escape closes and returns focus to the button
- A click outside the header closes it
- Clicking a nav link closes it, so navigating on mobile does not leave the
  panel hanging open

**No focus trap.** This is a disclosure, not a dialog. Trapping focus inside
one is a common accessibility mistake, and it is why `Modal` is the wrong prior
art to reuse here despite already implementing trapping, Escape and focus
restoration.

### The guard that is being removed

`AppShell.test.tsx` asserts `flex-wrap` in a test named "lets its header wrap
rather than overflow a narrow viewport". That class was added in the API keys
piece specifically to stop 380px overflow, and it was verified in a browser.

The hamburger supersedes that mechanism: below `md` the bar is only a logo and
a button, which cannot overflow. Keeping the class with a guard whose stated
rationale no longer holds would be worse than removing both, so both go, and
the protection is re-established by the disclosure tests plus browser checks.

This does relocate the risk. `flex-wrap` was also quietly covering the band
just above the breakpoint, where the full row reappears at its tightest.
**768px therefore becomes a named browser check**, not merely 380 and 1280.

## Tests

The 11 surviving `AppShell` tests need no changes. New behavioural tests:

- The menu is closed by default: `aria-expanded` is `false`
- Clicking the button opens it
- Escape closes it and returns focus to the button
- A click outside the header closes it
- Clicking a nav link closes it
- `aria-controls` names both panel IDs

None assert Tailwind classes.

## Verification

Every piece of UI work on this project has shipped at least one defect that
passing jsdom tests could not see, and `ToggleSwitch` in particular shipped an
18px knob overflow invisible to 265 passing tests, then later needed a
`shrink-0` fix when placed in a flex row. Browser checks are scoped work here.

1. **380px, closed:** the bar is logo plus hamburger, no horizontal overflow.
2. **380px, open:** all four groups readable and inside the viewport, in light
   and dark.
3. **768px:** the new risk point, where the full row reappears at its tightest.
   This is the case `flex-wrap` was covering before this change removed it.
4. **1280px:** identical to today, confirming desktop really is preserved.
5. **The switch itself:** knob inside the track, sun and moon rendering, the
   correct side accented in each theme.

## Out of scope

- **Changing `ToggleSwitch`.** Reasoning above.
- **The footer.** It already wraps and holds only three links.
- **A focus trap.** Deliberately rejected, not overlooked.
- **Animating the panel.** No transition is specified; the panel appears and
  disappears. Adding one is a separate, purely visual decision.

## Risks

- **`AppShell` renders on every authenticated page and the app is live**, so a
  regression is immediately user visible. This is why desktop preservation is
  a named check rather than an assumption.
- **Removing `flex-wrap` moves risk to the breakpoint boundary**, which is why
  768px is checked explicitly.
- **The disclosure has real state**, unlike everything else in this header. The
  failure modes are a menu that cannot be dismissed, or focus lost after
  closing, so both are tested directly.
