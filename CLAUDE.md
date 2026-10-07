# CLAUDE.md — vault (daily-notes app)

Vue 3 + Node daily-notes app. Notes are plain markdown at `daily/YYYY-MM-DD.md`; server is `src/server.cjs` (GET/PUT `/api/daily/:date`, overwrites whole file). Task-line grammar in `## Tasks`: `- [ ] > <slug> body` (order: checkbox, then optional `> ` worked-today flag, then optional status slug, then body). Slugs: wip/in-review/reviewing/needs-qa/qa (wip = no word); `[x]` = done. Jira keys are bare tokens (e.g. `CIAM-83 summary`).

## Status
Working tree (uncommitted): roll-forward statusline indicators (yellow while generating Weekly Update, green on complete, red on error) + skip-regeneration of an existing Weekly Update, in `src/App.vue` + `src/composables/useDaily.js`. New global skill `vault-tasks` (`~/.claude/skills/vault-tasks/`) created and self-tested — edits the `## Tasks` section byte-correctly. All complete; app edits not yet committed or exercised live.

## Active resume
- Answer the open Jira question: "Why do these persistently come before CIAM-15, though CIAM-15 is top of the ranking?" — clarify the VIEW (backlog rank / sprint board / JQL / vault Tasks) and which issues "these" are first; CIAM-15 wasn't in the open-issues pull, so likely a Jira board rank vs status/swimlane ordering issue.
- (Optional) Exercise app roll-forward indicators end-to-end; start using `vault-tasks` for today's Tier-1 items (CIAM-83, CIAM-18, CIAM-22, CIAM-82); commit the app edits.

## Side tracks
- **vault** — roll-forward indicators + skip-regen + `vault-tasks` skill done; next is the open Jira CIAM-15 ranking question. See `docs/sessions/vault-2026-09-04.md`.
