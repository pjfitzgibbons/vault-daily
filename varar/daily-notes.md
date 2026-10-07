# Vault — Daily Notes / Task App Spec

This is a living spec: the **checkable claims** below are verified against the real code in
`src/utils/**` by the sensors in `src/varar/daily-notes.steps.ts`. Run `npx varar run` to prove
them. Prose without a matching sensor is documentation only, not yet executable.

## Overview

Vault is a single-user daily-notes and task app. A raw Node server (`src/server.cjs`, default
port 8080, loopback-only unless `ALLOW_REMOTE`) serves a Vue 3 SPA and reads/writes one Markdown
file per weekday under `daily/YYYY-MM-DD.md`. Task state, standup, notes, and the Friday weekly
update all live as Markdown sections inside that file — the file *is* the database.

## Task line grammar

A task is a Markdown checkbox line inside the `## Tasks` or `## On Deck` section. An open task is
`- [ ]`, a done task is `- [x]`. An optional worked-today flag `> ` sits immediately after the
checkbox, and an optional status slug (one of wip, in-review, reviewing, needs-qa, qa, done)
follows that.

### Status transitions (`rewriteTaskStatus`)

Rewriting an open task to the **in-review** status leaves the box open, which is "true".
Rewriting an open task to the **in-review** status inserts the in-review slug, which is "true".
Rewriting any task to **done** collapses it to a checked box with no worked flag, which is "true".

### Worked-today flag (`ensureWorkedFlagOnLine`)

Marking an unflagged open task as worked-today inserts the `> ` flag, so afterwards the flag is "present".

## Roll-forward (weekday math)

When a note rolls forward to the next day, the date advances by one **weekday**, skipping weekends.
Rolling forward from Friday 2026-08-28 lands on "2026-08-31".
Rolling forward from Monday 2026-08-31 lands on "2026-09-01".
The date 2026-08-28 is a Friday, which is "true".

## Adding a task

Adding a task to the Tasks section appends a new open checkbox line, so afterwards the new line is "present".

## Notes & Weekly Update (documented, not yet sensored)

The `## Notes` section is a free-text textarea committed on blur; `Cmd+;` inserts the current
`HH:MM` at the cursor. On Fridays a `## Weekly Update` section is appended and can be drafted by
Claude via `POST /api/weekly-update`. These are UI/server behaviors without pure-function sensors
yet — see `tests/mutations.test.mjs` for the section-rewrite coverage that does exist.

## KNOWN ISSUE — per-keystroke input regression (documented, not yet sensored)

The user reports character entry in the **new-task input box** lagging/regressing. Root cause
identified during spec authoring, in `src/App.vue`:

- `onMounted` installs a **capture-phase global `input` listener** (`src/App.vue:578`) that is
  **not** key-filtered (unlike the `keydown` one).
- Every character typed into any input/textarea fires `onUiInteraction` (`src/App.vue:326`) →
  `logClient('debug', 'ui.interaction.input', …)` (`:283`), which does a synchronous `console.*`
  **and** a fire-and-forget `fetch('/api/client-log', {POST})` (`:266`) — one network POST **per
  keystroke**.
- In the Notes/Weekly textareas only, `useAutosize` (`src/composables/useAutosize.js:28`) also
  forces a synchronous `scrollHeight` layout read on every keystroke.

This is the most likely source of the regression. It is a live-DOM/network behavior, so it is
recorded here as a spec claim to be enforced by a future Playwright sensor
(`tests/e2e/…`), e.g. "typing N characters into the new-task box issues 0 `/api/client-log`
POSTs until commit." Fix direction: debounce or drop the per-keystroke `input` log, or key-filter
the global `input` listener the way `keydown` already is.
