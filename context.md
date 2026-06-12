# PKM Setup — Session Context

---

## Next: Task Status Widget (vault-daily-roll extension)

We want a per-task status selector in `## Tasks` sections of `vault/daily/*.md` files.
Statuses: **WIP** (default), **Needs-Review**, **Reviewing**, **Needs-QA**, **QA**, **Done**

The status prefix written back into the line is already read by `transformForStandup()` in the extension, so whatever option we implement will flow cleanly into roll-forward Standup output.

### Option A — CodeLens badge + QuickPick ✅ Recommended
Each task line gets a CodeLens above it showing current status (e.g. `● WIP`).  
Clicking opens a floating QuickPick with the six options.  
On selection the status prefix is rewritten into the task line in-place.  
- **Pros:** Idiomatic VS Code, no extra framework, already compatible with transform pipeline, one extra click.  
- **Cons:** Badge sits *above* the line, not inline.

### Option B — Hover provider with action buttons
Hovering a task line shows a tooltip with markdown buttons (`[WIP] [Needs-Review] [Done]`).  
Clicking a button triggers a command that updates the line.  
- **Pros:** Feels more inline.  
- **Cons:** Hover is transient, disappears on mouse move — unreliable for intentional edits.

### Option C — Command / keybinding (`Vault: Set Task Status`)
No widget — dedicated command opens a QuickPick on the current cursor line.  
Same QuickPick as A but keyboard-triggered, no visual affordance.  
- **Pros:** Fastest for keyboard-driven workflow.  
- **Cons:** No per-line status visible at a glance.

### Option D — WebView sidebar panel
Full custom HTML/CSS/JS panel listing all tasks with real `<select>` dropdowns.  
Two-way sync with the document.  
- **Pros:** True dropdown UX.  
- **Cons:** Significantly more code, harder to keep in sync with live edits, overkill.

---

Use this file to resume setup work in a new Claude Code session.

---

## What's done

### Extensions installed (all 4)
- `foam.foam-vscode` v0.43.1
- `svsool.markdown-memo` v0.3.19
- `yzhang.markdown-all-in-one` v3.6.3
- `Gruntfuggly.todo-tree` v0.0.226

### Vault scaffolded at `~/vault`
```
vault/
├── .foam/templates/daily-note.md   ← Foam daily note template (uses $FOAM_DATE_* vars)
├── .vscode/settings.json           ← extension config for Foam, Memo, Todo Tree, Markdown AiO
├── daily/2026-06-11.md             ← today's starter note
├── projects/_template.md           ← project hub template to copy per project
├── people/                         ← empty
├── areas/                          ← empty
├── resources/til.md                ← TIL log
└── inbox.md                        ← fast-capture scratchpad
```

### Config decisions baked into `.vscode/settings.json`
- Daily notes go in `daily/`, named `YYYY-MM-DD.md`
- Wiki-links use `[[note-name]]` format (no `.md` extension shown)
- Todo Tree scans all `.md` files for `- [ ]` / `- [x]`
- Word wrap on, line numbers off (prose-friendly editor)

---

## What's NOT done yet

- [ ] **Reload the vault VSCode window** — `Cmd+Shift+P` → "Developer: Reload Window" to activate Foam's backlinks panel and graph view
- [ ] **Migrate `today.md`** — file lives at `/Users/pfitzgibbons/Downloads/standup-cli/today.md`; paste its content into `daily/2026-06-11.md` (or whichever date applies), then decide whether to keep `today.md` as a symlink or retire it
- [ ] **Create first real project hub** — copy `projects/_template.md`, rename to the project slug (e.g. `projects/my-project.md`), fill in Jira/Confluence/Repo links
- [ ] **Create people notes** — one `.md` per teammate in `people/` as 1:1s come up
- [ ] **Verify Todo Tree is scanning correctly** — open Todo Tree panel, confirm `- [ ]` items from daily notes appear
- [ ] **Optional: add a keybinding for "Open Daily Note"** — Foam command is `foam-vscode.open-daily-note`; add to `keybindings.json` if desired

---

## User context (carry into next session)

- Senior Software Developer, team of ~15
- Works across 3+ VSCode windows simultaneously
- Org tools: GitHub, Jira, Confluence, Microsoft Teams — no integrations required
- Has `today.md` standup file in `/Users/pfitzgibbons/Downloads/standup-cli/` — this is the thing being replaced/migrated
- Priorities: wiki-style linking > searchability > daily note with tasks > low friction capture
- Has abandoned: OneNote, Obsidian, plain text files

---

## Agreed conventions (don't re-litigate)

- **Folders are for filing, links are for finding** — daily notes link *out* to project/area/people notes; backlinks accumulate passive history
- One dedicated VSCode window for `~/vault`, open alongside project windows
- Weekly triage: Friday or Monday, ~15 min — triage inbox, scan week's dailies, update project hubs
