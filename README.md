# Lunapad

A notebook-style IDE for [PRQL](https://prql-lang.org/) and SQL that runs entirely in the browser. Each notebook cell is a dbt model — cells reference each other by name, and are assembled into a `WITH` CTE chain at query time with no dbt invocation needed for interactive runs.

**Query engines:**

- **DuckDB WASM** — built-in, zero config, runs in the browser
- **Trino** — used for all external data sources (Postgres, ClickHouse, MySQL)

**Using Lunapad?** See the [user guide](docs/guide/README.md) for a full walkthrough: notebooks, queries, data sources, dashboards, the AI assistant, the API/MCP server, and self-hosting. This README covers running and developing Lunapad itself.

---

## Docker (recommended)

The compose file starts Lunapad, Trino, Postgres, and an Inngest scheduler together. No configuration needed to get started.

```bash
# First run (builds the app image, ~3 min)
docker compose up --build

# Subsequent starts
docker compose up -d
```

| Service    | URL                   |
| ---------- | --------------------- |
| Lunapad    | http://localhost:3000 |
| Trino      | http://localhost:8080 |
| Inngest UI | http://localhost:8288 |
| Postgres   | localhost:5432        |

**Startup order:** Postgres → Trino (waits for `starting: false`) → App → Inngest. Trino takes ~60s on first start; the app won't serve until it's ready.

**Sample data available immediately** — no setup needed:

```sql
SELECT * FROM tpch.tiny.nation
SELECT * FROM tpch.tiny.orders LIMIT 100
```

A `docker_postgres` catalog is also pre-wired to the bundled Postgres instance (`tpch.tiny.*` equivalent for Postgres queries).

### Useful commands

```bash
docker compose logs -f          # tail all services
docker compose logs -f trino    # tail just Trino
docker compose ps               # check health status (all should show "healthy")
docker compose down             # stop, keep data
docker compose down -v          # stop and wipe all data (fresh start)
```

---

## Adding a data source

1. Click **Data Sources → Add source** in the left sidebar
2. Fill in connection details (Postgres, ClickHouse, or MySQL)
3. Click **Save** — Lunapad writes a Trino catalog file and waits for Trino to restart and load it (~15s)

Once saved, reference the source in any cell using `catalogName.schema.table`:

```prql
from docker_postgres.public.users
filter active == true
select {id, email}
```

The **Source ID** (catalog name) is set when you create the source and cannot be changed. It must be lowercase letters, digits, and underscores, starting with a letter.

---

## Local development

Requires Node 22, pnpm 9, and a running Trino instance (the Docker compose infra works fine alongside a local dev server).

```bash
pnpm install
pnpm dev          # starts on http://localhost:5173
```

Required environment variables when running outside Docker:

| Variable              | Default             | Description                                                                                                                                   |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRINO_URL`           | `http://trino:8080` | Trino coordinator URL                                                                                                                         |
| `TRINO_CATALOG_DIR`   | —                   | Path Trino reads catalog `.properties` files from. For Docker compose local dev: `./trino/catalog`                                            |
| `INNGEST_BASE_URL`    | —                   | Inngest dev server URL (omit to disable scheduling)                                                                                           |
| `INNGEST_EVENT_KEY`   | —                   | Set to `local` for dev                                                                                                                        |
| `INNGEST_SIGNING_KEY` | —                   | Set to `local` for dev                                                                                                                        |
| `PROJECT_FOLDER`      | —                   | Default dbt project folder, auto-opened on startup. If the folder is empty, a dbt-best-practices project is scaffolded into it automatically. |

For local dev pointing at the Docker infra:

```bash
TRINO_URL=http://localhost:8080 \
TRINO_CATALOG_DIR=./trino/catalog \
INNGEST_BASE_URL=http://localhost:8288 \
INNGEST_EVENT_KEY=local \
INNGEST_SIGNING_KEY=local \
pnpm dev
```

### All dev commands

```bash
pnpm dev          # dev server (requires COOP/COEP headers — handled by vite.config.ts)
pnpm build        # production build
pnpm test         # unit tests (vitest)
pnpm test:e2e     # Playwright e2e tests
pnpm check        # svelte-check type checking
pnpm lint         # prettier --check
pnpm format       # prettier --write
```

Run a single test file:

```bash
pnpm vitest run src/lib/services/cell-deps.test.ts
```

---

## How cells work

Each cell has an **output name** (the variable in the top-left input). Cells that reference another cell's output name automatically get it as a CTE dependency:

```prql
# cell: orders_clean
from tpch.tiny.orders
filter status == "F"
```

```prql
# cell: summary  (references orders_clean automatically)
from orders_clean
aggregate { total = sum this }
```

At run time, `summary` compiles to:

```sql
WITH orders_clean AS (
    SELECT * FROM tpch.tiny.orders WHERE status = 'F'
)
SELECT SUM(*) AS total FROM orders_clean
```

**Language modes per cell:** PRQL (default), Visual (drag-drop pipeline), SQL. SQL cells on external connections skip PRQL compilation and prepend CTEs directly.

---

## Trino catalog management

Lunapad manages Trino catalogs by writing `.properties` files to `TRINO_CATALOG_DIR` (bind-mounted into both the `app` and `trino` containers at `./trino/catalog`). When a new source is registered:

1. The catalog `.properties` file is written to `TRINO_CATALOG_DIR`
2. If Trino already has the catalog active, done
3. Otherwise, a graceful shutdown is triggered (`PUT /v1/info/state SHUTTING_DOWN`)
4. Docker's `restart: unless-stopped` brings Trino back up
5. App polls `/v1/info` until `starting: false`, then verifies the catalog is active

Existing catalog files in `./trino/catalog/` survive restarts. The `tpch.properties` and `docker_postgres.properties` files are version-controlled and always present.

---

## dbt integration

Open a dbt project folder via **File → Open project**, or let the deployment's default
folder open automatically (see `PROJECT_FOLDER` below). When a project is open:

- Models are compiled with `dbt compile` and the manifest is used for schema and lineage
- Run/test buttons appear per-cell for dbt models
- Scheduled materializations use Inngest functions (`dbt run --select model`)

In Docker, `PROJECT_FOLDER=/app/project` (bind-mounted from `./project` on the host) is
auto-opened on first load; if empty, a dbt-best-practices project (staging/intermediate/marts
layout, `profiles.yml`, etc.) is scaffolded into it automatically. Opening a different folder
from the UI always takes precedence over the default on later reloads.
