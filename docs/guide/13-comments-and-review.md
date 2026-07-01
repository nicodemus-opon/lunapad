# Comments and review

Lunapad stores team comments in Postgres — separate from the shared workspace blob — so review threads survive concurrent edits and last-write-wins workspace saves.

## Cell comments

- Click the **message icon** in a cell gutter, or press **⌘⇧C** when a cell is focused.
- Start from a template or write your own thread.
- **Resolve** when the discussion is done.

## Inbox

Use the **Review** toggle in the notebook header (next to AI), or open the panel and switch to the **Inbox** tab.

- Threads assigned to you
- @mentions
- Open comments on published reports (share review)

## Review mode

In the Review panel menu (⋯), enable **Highlight open threads** to mark cells with open comments.

## Roles

| Role | Edit notebooks | Comment | Publish shares |
|------|----------------|---------|----------------|
| admin | yes | yes | yes |
| editor | yes | yes | yes |
| viewer | no | yes | no |

The legacy `user` role is treated as **editor**.

## Workspace conflicts

When two teammates save at once, Lunapad detects a conflict and offers **Reload** (take server copy) or **Keep mine** (force save).

## Per-user LLM keys

API keys for AI providers are stored in your user settings, not the shared workspace blob.
