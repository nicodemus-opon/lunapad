# Comments and review

Team comments live in Postgres, separate from the shared workspace JSON blob. Threads survive concurrent edits and last-write-wins workspace saves. If two people edit the same notebook at once, comments stay put even when someone picks **Reload** on a workspace conflict.

## Starting a thread

On any cell, click the **message icon** in the gutter or press **⌘⇧C** while the cell is focused. The Review panel opens on that cell.

Pick a template or write your own:

| Template         | Typical use               |
| ---------------- | ------------------------- |
| Logic question   | Ask how a transform works |
| Data check       | Flag suspicious numbers   |
| Ready for review | Hand off for sign-off     |
| Add a test       | Request a dbt test        |

The first message creates the thread. A badge on the gutter shows how many open threads that cell has.

Today, threads attach to **cells** only. The database schema also has anchor types for line ranges, result rows, chart points, and GUI stages, but the UI for those isn't shipped yet.

## Replying and mentions

Type in the composer at the bottom of the panel. **⌘↵** sends.

Mention a teammate with `@` plus their mention handle (shown in the placeholder). Mentioned users get an inbox item with reason `mention`.

Mark **resolved** when the discussion is done. Resolved threads stay readable; reopen from the thread menu if the issue comes back. Editors and admins can resolve any thread; other participants can resolve threads they started.

## Inbox

Toggle **Review** in the notebook header (next to AI), or open the panel and switch to the **Inbox** tab.

| Reason       | Why it appears                                 |
| ------------ | ---------------------------------------------- |
| Assigned     | Thread has you as assignee (set via API today) |
| Mention      | Your `@handle` appears in a reply              |
| Unresolved   | Open threads you participate in                |
| Share review | Comments on a published report                 |

Unread counts show on the Review toggle and on individual threads. Lunapad polls for updates every few seconds while the app is open.

## Review mode

In the Review panel menu (⋯), turn on **Highlight open threads**. Cells with unresolved comments get a visible marker in the gutter so you can scan a long notebook before a review meeting.

## Roles

| Role   | Edit notebooks | Comment | Publish shares |
| ------ | -------------- | ------- | -------------- |
| admin  | yes            | yes     | yes            |
| editor | yes            | yes     | yes            |
| viewer | no             | yes     | no             |

The legacy `user` role is treated as **editor**.

Viewers can read notebooks, comment on cells and shares, and use the inbox. They cannot edit cell code, add connections, run dbt writes, or publish. If you need someone who only reviews numbers, viewer is the right role.

**Note:** Settings → Team currently creates users with the default role from better-auth (usually editor). Assigning viewer today requires updating the `role` column in Postgres or using the invitations API with `"role": "viewer"`. A role picker in Team settings is not in the UI yet.

## Workspace conflicts

When two teammates save the workspace at nearly the same time, Lunapad detects a version mismatch (HTTP 409) and shows a banner:

- **Reload** discards your local changes and takes the server copy.
- **Keep mine** force-saves your version over the server.

Comments are unaffected either way. Notebook content is not merged automatically; pick the version you want and coordinate with your teammate if you both edited the same cell.

## Per-user LLM keys

Not specific to comments, but relevant on shared instances: each user's AI provider settings are stored in their account, not the workspace blob. See [AI assistant](07-ai-assistant.md).

## Next

[Self-hosting](11-self-hosting.md) for team setup, or [FAQ](12-faq-troubleshooting.md) if something isn't showing up.
