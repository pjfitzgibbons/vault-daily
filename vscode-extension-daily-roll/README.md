# Vault Daily Roll VS Code Extension

This extension adds an editor-title button for `vault/daily/YYYY-MM-DD.md` files.

## Command

- `Vault Daily: Roll Forward`

When run from a daily note:

- Completed task checkboxes (`- [x] ...`) become next day's `Standup` `Yesterday` bullets.
- Remaining task checkboxes (`- [ ] ...`) become next day's `Standup` `Today` bullets.
- Completed tasks are removed from next day's `Tasks` section.
- Next day's `Notes` section is cleared to the standard placeholder.

If the next day's file already exists, the extension does not overwrite it.
