# Vault Daily UI — Architecture

## Overview

A Vue 3 + Vite single-page application served by the existing Node.js server.
The server handles all file I/O and Jira proxying; the Vue app is a pure UI layer.

```
vault/
├── server.js              # Node HTTP server (unchanged API contract)
├── config.json            # Vault path, port, Jira credentials
├── package.json           # adds "dev" and "build" scripts
├── daily/                 # markdown files (YYYY-MM-DD.md)
├── projects/              # wikilink targets (*.md)
├── src/                   # Vue 3 + Vite source
│   ├── index.html
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   ├── components/
│   │   │   ├── AppToolbar.vue
│   │   │   ├── StandupPanel.vue
│   │   │   ├── TaskPanel.vue          # Tasks + On Deck share this
│   │   │   ├── TaskRow.vue
│   │   │   ├── NotesPanel.vue
│   │   │   └── WikilinkInput.vue      # reusable [[...]] autocomplete input
│   │   ├── composables/
│   │   │   ├── useDaily.js            # load/save current date file
│   │   │   ├── useProjects.js         # fetch project names for wikilink
│   │   │   └── useSplitter.js         # panel resize + localStorage persist
│   │   └── utils/
│   │       ├── parser.js              # parseSections, parseStandup, parseTaskLines
│   │       ├── mutations.js           # rewriteTaskStatus, toggleTask, addTask, deleteTask
│   │       └── rollForward.js         # buildNextDayContent, transformForStandup
└── dist/                  # built output (served by server.js in production)
```

---

## Server API (unchanged contract)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve `dist/index.html` (prod) or proxy to Vite dev server |
| GET | `/api/daily/:date` | `{ date, content, exists }` |
| PUT | `/api/daily/:date` | `{ content }` → save file |
| GET | `/api/dates` | `["2026-06-11", "2026-06-12", …]` |
| GET | `/api/projects` | `["Docker-Ruby", "Order API", …]` ← **new** |
| POST | `/api/jira/standup` | `{ date, yesterday[], today[], blockers }` |

The `/api/projects` endpoint reads `projects/*.md`, strips `_template.md`, returns
base names (no extension) sorted alphabetically. Used by `WikilinkInput`.

In **dev** mode (`npm run dev`), Vite runs on `:5173` and proxies `/api/*` to
`:8080` via `vite.config.js`. In **production** (`npm run build`), `server.js`
serves `dist/` statically.

---

## Data flow

```
server.js  ←──── fetch() ────→  useDaily.js (composable)
                                    │
                                    │ rawContent (ref<string>)
                                    ▼
                              parser.js (pure fns)
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                   sections{}            standup{}
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         TaskPanel  StandupPanel  NotesPanel
              │
          TaskRow (per task)
              │
        WikilinkInput (inline edit)
```

**Write path:** every mutation calls a function in `mutations.js` that returns a
new `rawContent` string. `useDaily` exposes `rawContent` as a `ref`; mutations
write back to it and set `dirty = true`. `Cmd+S` / Save button calls
`useDaily.save()` which PUTs to the server.

Sections (Tasks, On Deck, Standup, Notes) are never fully re-serialized from
component state. Instead, `mutations.js` performs **surgical line replacement**
on `rawContent`, preserving all markdown formatting, link refs, and frontmatter
verbatim. This is the same strategy as the current `daily.html`.

---

## Component responsibilities

### `App.vue`
- Owns the `useDaily` composable instance (single source of truth for `rawContent`, `currentDate`, `dirty`)
- Owns the 4-panel CSS grid + splitter state via `useSplitter`
- Passes `sections` (derived from `rawContent`) as props to panels
- Handles keyboard shortcuts (Cmd+S, Cmd+;, Escape)

### `AppToolbar.vue`
- Prev / Today / Next date navigation
- Roll Forward, Submit Standup, Save buttons
- Receives `currentDate`, `dirty` as props; emits `navigate`, `rollForward`, `submitStandup`, `save`

### `StandupPanel.vue`
- Three textarea/input fields: Yesterday, Today, Blockers
- `v-model` bound to local copies; on change emits `update:standup` with raw line arrays
- Parent (`App.vue`) calls `mutations.rebuildStandupSection(rawContent, standup)` and writes back

### `TaskPanel.vue`
- Props: `tasks` (parsed array), `sectionName` ("Tasks" | "On Deck")
- Renders a `TaskRow` per task + the `+ Add` row
- Emits: `add(text)`, `delete(rawLine)`, `update(oldRaw, newRaw)`

### `TaskRow.vue`
- Props: `task` `{ raw, done, body, status }`
- Checkbox toggle, inline edit via `WikilinkInput`, status badge + dropdown, delete button
- Emits: `change(newRaw)`, `delete`

### `WikilinkInput.vue`
- A general-purpose text input with `[[` trigger autocomplete
- Props: `modelValue` (string), `projects` (string[])
- When user types `[[`, shows a floating dropdown fuzzy-filtered against `projects`
- Selecting an item inserts `[[ProjectName]]` and closes the dropdown
- Also renders display mode (read-only): replaces `[[Name]]` with a styled `<span>`
- Emits: `update:modelValue`, `commit`, `cancel`

### `NotesPanel.vue`
- Monospace textarea bound to the Notes section content
- "Insert Time" button (Cmd+; shortcut)
- Emits `update:notes`

---

## `utils/parser.js` (pure, no Vue)

```js
parseSections(rawContent)   // → { frontmatter, titleLine, order, sections:{name→lines[]} }
parseStandup(lines)         // → { yesterday:[], today:[], blockers:'' }
parseTaskLines(lines)       // → [{ raw, done, body, status }]
parseRawTasks(lines)        // → { completed:[], remaining:[] }  (for roll-forward)
```

## `utils/mutations.js` (pure, no Vue)

```js
rewriteTaskStatus(rawLine, slug)           // → new raw line string
addTaskToSection(rawContent, section, text) // → new rawContent string
deleteTaskFromSection(rawContent, rawLine)  // → new rawContent string
editTaskBody(rawContent, oldRaw, newBody)  // → new rawContent string
rebuildStandupSection(rawContent, standup) // → new rawContent string
rebuildNotesSection(rawContent, notesText) // → new rawContent string
buildFreshContent(date, standup)           // → full file string for new files
```

## `utils/rollForward.js` (pure, no Vue)

```js
transformForStandup(text, addContinuing)   // strip tickets, add "Continuing"
buildNextDayContent(nextDate, completed, remaining, onDeck) // → full file string
```

---

## `composables/useDaily.js`

```js
const { rawContent, currentDate, dirty, sections, fileExists,
        loadDate, save, rollForward } = useDaily()
```

- `rawContent`: `ref<string>` — single source of truth
- `sections`: `computed` — calls `parseSections(rawContent.value)`
- `loadDate(date)`: fetch `/api/daily/:date`, set `rawContent`, clear `dirty`
- `save()`: PUT `/api/daily/:currentDate`, clear `dirty`
- `rollForward()`: build next-day content, PUT, navigate forward

## `composables/useProjects.js`

```js
const { projects } = useProjects()
```

- Fetches `/api/projects` once on mount, returns `ref<string[]>`
- Used by every `WikilinkInput` instance via `provide/inject` from `App.vue`
  (so the fetch happens once, not per-row)

## `composables/useSplitter.js`

```js
const { initSplitters, loadState } = useSplitter()
```

- Same drag logic as current `daily.html`, extracted cleanly
- Persists col/row sizes to `localStorage`

---

## WikilinkInput — interaction design

```
user types:  "CP-146 [[
                       ^── triggers dropdown

dropdown shows (fuzzy filtered):
  ┌─────────────────┐
  │ Docker-Ruby     │  ← highlighted
  │ Order API       │
  │ Rental Series   │
  └─────────────────┘

user types "rent":
  ┌─────────────────┐
  │ Rental Series   │
  └─────────────────┘

Enter or click → inserts "[[Rental Series]]"
Escape          → closes dropdown, leaves "[[" text as-is
```

**Display mode** (read-only span): `[[Rental Series]]` renders as a styled badge.
The link href (`../projects/Rental Series.md`) is present but navigation is
suppressed (this is a task manager, not a wiki viewer).

---

## Build & dev workflow

```bash
# Dev (Vite HMR + server API)
npm run dev          # starts both: vite (5173) + node server.js (8080)

# Production
npm run build        # vite build → dist/
node server.js       # serves dist/ on :8080
```

`package.json` scripts use `concurrently` to run both processes in dev.

---

## Migration strategy

1. Scaffold `src/` alongside existing `daily.html` (no breakage)
2. Port `utils/` first — they are pure JS, fully testable, no Vue dependency
3. Add `/api/projects` to `server.js`
4. Build components bottom-up: `WikilinkInput` → `TaskRow` → `TaskPanel` → panels → `App`
5. When feature-complete, update `server.js` to serve `dist/` as the default route
6. Archive `daily.html` (keep for reference)
