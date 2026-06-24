# FAQ and troubleshooting

**The app isn't responding right after `docker compose up`.**
Trino takes about a minute to finish starting, and the app waits for it to be healthy before serving requests. Run `docker compose ps` and wait for everything to say `healthy`.

**I can't change a data source's Source ID.**
That's by design, it's the Trino catalog name and changing it after the fact would orphan anything already referencing it. Remove the source and re-add it with the ID you want.

**A cell has no Run/Compile/Test buttons for dbt.**
Those only appear for cells backed by a real model file dbt can see: a standalone model file, or a `.luna` notebook cell you've promoted. A cell still living inside an unpromoted `.luna` notebook runs interactively in Lunapad but isn't part of the dbt build yet. See [dbt projects](08-dbt-projects.md).

**The AI panel won't respond to anything.**
There's no built-in hosted model. Set a provider, base URL, and model in Settings → AI first. See [AI assistant](07-ai-assistant.md).

**I'm on a public demo instance and some things are disabled.**
Demo mode (`DEMO_MODE=1`) deliberately blocks external connections, dbt, workspace persistence, and the automation API, so a public read-only deployment can't be used to reach real infrastructure. That's expected, not a bug.

**Where did my data go after a restart?**
Depends on how you stopped it. `docker compose down` keeps your Postgres volume (workspace, accounts, connections) intact. `docker compose down -v` wipes it. Anything in an open project folder lives on your host filesystem either way and isn't affected by either command.

**Can I have more than one isolated workspace?**
Not within a single Lunapad instance. It's built around one shared workspace per deployment, everyone with an account sees the same notebooks, projects, and connections. Run a separate instance (separate Postgres, separate Docker Compose project) if you need real separation.

**How do I add a teammate?**
Only the admin (the first account created) can. From Settings → Team, give them an email and a temporary password directly, there's no email invite flow. They can change the password after logging in.
