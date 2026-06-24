# Self-hosting

## Docker Compose (recommended)

The bundled `docker-compose.yml` runs four services:

- **app**: Lunapad itself
- **db**: Postgres, the source of truth for accounts, the shared workspace (notebooks, cells, AI chat settings), and connection metadata/secrets in full (non-demo) mode
- **trino**: fronts every external data source (Postgres/ClickHouse/MySQL connections become Trino catalogs)
- **inngest**: runs scheduled dbt model builds

Start order matters and is health-checked automatically: Postgres, then Trino, then the app, then Inngest. First start takes about a minute because Trino needs that long to come up.

```bash
docker compose up --build   # first run
docker compose up -d        # subsequent starts
docker compose logs -f      # tail everything
docker compose ps           # confirm everything is "healthy"
docker compose down         # stop, keep data
docker compose down -v      # stop and wipe everything (fresh start)
```

## Environment variables

Set these on the `app` service. The committed `docker-compose.yml` ships working defaults for local trial use, replace the secrets before deploying anywhere real.

| Variable | Default in the compose file | What it's for |
|---|---|---|
| `DATABASE_URL` | `postgresql://lunapad:lunapad@db:5432/lunapad` | Connection string for the shared Postgres instance |
| `BETTER_AUTH_SECRET` | `change-me-to-a-random-32-byte-secret` | Signs session tokens. **Replace this before any real deployment.** |
| `SECRETS_ENCRYPTION_KEY` | `change-me-to-a-random-32-byte-base64-key` | Encrypts stored connection passwords at rest. **Replace this too, and never reuse the value from `BETTER_AUTH_SECRET`.** |
| `TRINO_URL` | `http://trino:8080` | Where the app reaches Trino |
| `TRINO_CATALOG_DIR` | `/trino-catalog` | Where catalog `.properties` files are written when you add a data source |
| `PROJECT_FOLDER` | `/app/project` | A dbt project folder to auto-open on startup. If it's empty, a starter project is scaffolded into it. Opening a different folder from the UI overrides this on later reloads. |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Reaches an Ollama install running on the host machine, only relevant if you're using Ollama for the AI assistant |
| `INNGEST_BASE_URL` / `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | `http://inngest:8288` / `local` / `local` | Scheduler connection. Omit `INNGEST_BASE_URL` entirely to disable scheduling |
| `DEMO_MODE` | unset | Set to `1` to run a public, read-only-ish demo deployment, see below |

## What's stored where

| Location | Holds |
|---|---|
| Postgres | Accounts and sessions, the entire shared workspace (notebooks, cells, AI settings) in full mode, connection metadata, encrypted connection secrets |
| Your browser's local storage | A cache of the workspace for offline use, not the source of truth in full mode |
| Your project folder (if one is open) | Your actual dbt project: model files, `.luna` notebook files, `schema.yml`, `dbt_project.yml` |
| `./trino/catalog/` | One `.properties` file per external data source you've registered |

This matters mainly for backups: back up the Postgres volume and your project folder, and you've covered everything that isn't trivially reconstructible.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Data persists across this as long as you don't run `down -v`, since that wipes the Postgres volume along with everything in it.

## Adding teammates

Only the admin can add accounts; there's no self-service signup once the first account exists. From Settings → Team, give them a name, email, and temporary password directly. They show up immediately and can log in right away.

![The Team members settings panel with a form to add a teammate by name, email, and temporary password, and a list showing the admin account](images/11-settings-team.png)

## Demo mode

Setting `DEMO_MODE=1` turns off authentication and blocks the routes that would let a visitor reach external connections, dbt, the workspace-persistence API, or the automation API, even with no client involved. Useful for a public read-only demo instance; not a substitute for real auth on a deployment with real data.

## Other ways to run it

- **Desktop app.** A native Tauri build, if you'd rather not run Docker at all.
- **Outside Docker.** Possible, but you're then responsible for running Postgres, Trino, and (optionally) Inngest yourself and pointing the same environment variables at them. See the repository's main `README.md` for the local development setup.

## Next

[FAQ and troubleshooting](12-faq-troubleshooting.md).
