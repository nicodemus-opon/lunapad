# FAQ and troubleshooting

**The app isn't responding right after `docker compose up`.**
Trino takes about a minute to finish starting, and the app waits for it to be healthy before serving requests. Run `docker compose ps` and wait for everything to say `healthy`.

**I can't change a data source's Source ID.**
That's intentional. The source ID is the Trino catalog name; changing it after the fact would orphan anything already referencing it. Remove the source and re-add it with the ID you want.

**A cell has no Run/Compile/Test buttons for dbt.**
Those only appear for cells backed by a real model file dbt can see: a standalone model file, or a `.luna` notebook cell you've promoted. A cell still living inside an unpromoted `.luna` notebook runs interactively in Lunapad but isn't part of the dbt build yet. See [dbt projects](08-dbt-projects.md).

**The AI panel won't respond to anything.**
There's no built-in hosted model. Set a provider, base URL, and model in Settings → AI first. See [AI assistant](07-ai-assistant.md).

**Ghost text never appears.**
Turn it on in Settings → AI and confirm your LLM base URL and model work (try the AI panel). Ghost text only shows in PRQL/SQL editors when the provider responds in time.

**Inline AI (⌘⇧K) says no provider configured.**
Same fix as the AI panel: Settings → AI. Keys are per-user, not shared across the workspace.

**I'm on a public demo instance and some things are disabled.**
Demo mode (`DEMO_MODE=1`) blocks external connections, dbt, workspace persistence, and the automation API. Expected, not a bug.

**Where did my data go after a restart?**
`docker compose down` keeps your Postgres volume (workspace, accounts, connections) intact. `docker compose down -v` wipes it. Anything in an open project folder lives on your host filesystem either way.

**Two of us edited at once and now I see a conflict banner.**
Someone else saved the workspace after you loaded it. **Reload** takes their version; **Keep mine** overwrites with yours. Comments are separate and won't disappear. See [Comments and review](13-comments-and-review.md).

**Comments or inbox items aren't showing up.**
You need to be logged in on a non-demo instance. Open the Review panel and check the Inbox tab. Poll interval is a few seconds; refresh the page if you just were mentioned. Cell threads require clicking the gutter icon or ⌘⇧C on a focused cell to start.

**I'm a viewer and can't publish a share.**
Viewers can comment but not publish. Ask an editor or admin to publish, or have an admin change your role (database or invitation API today; no role picker in Team settings yet).

**A site URL returns 404.**
Site slugs and page slugs must be lowercase letters, digits, or hyphens, 3–64 characters (`revenue-q1`, not `Revenue Q1`). URL is `/s/{siteSlug}/{pageSlug}`. The page must reference a share that isn't revoked.

**Python cell fails immediately.**
Python runs server-side. In Docker, pandas/numpy/plotly are pre-installed. Outside Docker, the first run may download a venv (needs network). Read the traceback in the cell output; missing imports often mean the package isn't in the curated set.

**What keyboard shortcuts exist?**
Press `?` in the app for the full list. See [Notebooks and cells](02-notebooks-and-cells.md) for the common ones.

**Can I have more than one isolated workspace?**
Not within a single Lunapad instance. Everyone with an account sees the same notebooks, projects, and connections. Run a separate instance (separate Postgres, separate Docker Compose project) if you need real separation.

**How do I add a teammate?**
Admins only. Settings → Team: email and temporary password. Or `POST /api/invitations` and send the `/invite/{token}` link. See [Self-hosting](11-self-hosting.md).
