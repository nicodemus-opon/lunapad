# API and MCP

Lunapad exposes a REST API and an MCP server, both protected by the same personal API keys. Use them to script against your workspace from CI, a cron job, or an MCP-capable client like Claude Desktop or Claude Code — including creating and editing whole notebooks (dashboards, charts, SQL/PRQL/Python/Plot cells) headlessly, at parity with what the in-app AI chat agent can do.

This is built for a trusted, self-hosted team, not as a public multi-tenant integration surface. A key can only do what its scopes (see below) and its owner's role allow.

`DEMO_MODE=1` blocks the automation API entirely.

## Creating a key

Open Settings → API Keys. Give it a name, an optional expiry (30/90/365 days, or never), pick **scopes**, and create it. The full key is shown exactly once; copy it immediately. Lunapad only stores a hash afterward and can't show it to you again. Revoke a key any time from the same screen.

![The API Keys settings panel showing a created key, masked, with its creation date and revoke action](images/10-api-keys.png)

A key works as a bearer token in place of a browser session cookie:

```bash
curl http://localhost:3967/api/v1/connections \
  -H "Authorization: Bearer lp_live_..."
```

### Scopes

> **Breaking change:** a key created with no scopes selected used to have full access. It's now **read-only** by default (`workspace:read`, `connections:query`, `shares:read`, `dbt:read`, `ai:read`). If you have an existing unscoped key that a script relies on for writes (creating notebooks, running dbt, publishing shares), regenerate it and select the scopes it needs, or grant it `automation:full`.

| Scope | Grants |
| --- | --- |
| `workspace:read` | List/get/inspect/validate notebooks |
| `workspace:write` | Create, patch, and run notebook cells |
| `connections:query` | Run raw SQL/PRQL against a connection |
| `connections:manage` | Add/edit/remove connections |
| `dbt:read` | Read the manifest, poll job status |
| `dbt:run` | Run/compile dbt models |
| `shares:read` | List published shares |
| `shares:publish` | Publish a notebook as a share |
| `sites:manage` | Manage multi-page sites |
| `automation:full` | Everything above, in one grant |

`admin:manage` (gates Python-cell execution — see below) is **not** an assignable key scope; it always requires the key owner to hold the admin role directly, the same way the interactive `/api/python/*` endpoints already work. No key, however broadly scoped, can execute Python through automation unless its owner is an admin.

## REST API (`/api/v1`)

A deliberately curated subset, not full parity with every UI route — but full parity for notebook authoring specifically:

| Endpoint | What it does | Scope |
| --- | --- | --- |
| `GET /api/v1/connections` | List configured data sources | `connections:query` |
| `POST /api/v1/query` | Run raw SQL against a connection | `connections:query` |
| `POST /api/v1/prql` | Compile PRQL and run it against a connection | `connections:query` |
| `GET /api/v1/notebooks` | List notebooks (project-folder mode only) | `workspace:read` |
| `GET /api/v1/notebooks/[id]` | Get one notebook's cells | `workspace:read` |
| `POST /api/v1/notebooks` | Create a whole notebook from a blueprint | `workspace:write` |
| `PATCH /api/v1/notebooks/[id]` | Patch an existing notebook (blueprint/document/operations/rename) | `workspace:write` |
| `POST /api/v1/notebooks/run` | Run cells (`{folder?, notebookId, cellIds?}` in body) | `workspace:write` |
| `POST /api/v1/notebooks/validate` | Validate a notebook (`{folder?, notebookId}` in body) | `workspace:write` |
| `POST /api/v1/dbt/run` | Run dbt models | `dbt:run` |
| `POST /api/v1/dbt/compile` | Compile dbt models | `dbt:run` |
| `GET /api/v1/dbt/jobs/[jobId]` | Check a dbt job's status | `dbt:read` |
| `GET /api/v1/dbt/manifest` | Get the compiled model graph | `dbt:read` |

Notebook read/write only works when a project folder is open in filesystem mode (see [dbt projects](08-dbt-projects.md)) — notebooks that exist only in a browser tab's local storage aren't reachable this way. `notebooks/run` and `notebooks/validate` take `notebookId` in the request body rather than the URL, since a notebook id is itself a path (e.g. `models/staging/stg_orders`) and can't be disambiguated from a literal `/run` suffix in the URL.

### Example: create a notebook

```bash
curl -s http://localhost:3967/api/v1/notebooks \
  -H "Authorization: Bearer lp_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "notebookId": "models/reporting/monthly_summary",
    "title": "Monthly Summary",
    "executableCells": [{
      "cellId": "q1",
      "outputName": "monthly_revenue",
      "cellType": "query",
      "language": "prql",
      "connectionId": "my_postgres",
      "code": "from orders\ngroup month (aggregate revenue = sum amount)"
    }],
    "blocks": [
      { "type": "queryBlock", "cellId": "q1" },
      { "type": "metric", "value": "$monthly_revenue.revenue", "label": "Revenue" }
    ]
  }'
```

A failed compile returns HTTP 422 with `{ "diagnostics": [...] }` instead of writing anything — fix the reported issue and retry. A successful create/patch/validate returns HTTP 200.

### Example: run then validate

```bash
curl -s http://localhost:3967/api/v1/notebooks/run \
  -H "Authorization: Bearer lp_live_..." -H "Content-Type: application/json" \
  -d '{"notebookId": "models/reporting/monthly_summary"}'

curl -s http://localhost:3967/api/v1/notebooks/validate \
  -H "Authorization: Bearer lp_live_..." -H "Content-Type: application/json" \
  -d '{"notebookId": "models/reporting/monthly_summary"}'
```

`run` executes every query/python/plot cell (or just `cellIds` if given) and returns each cell's rows/columns/error. `validate` re-checks the on-disk document's schema, container rules, and `$ref` resolution against live cell outputs — call it after any create/patch/run to confirm `{"ok": true}` before treating the notebook as finished.

### Example: run SQL directly

```bash
curl -s http://localhost:3967/api/v1/query \
  -H "Authorization: Bearer lp_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "my_postgres",
    "sql": "SELECT id, email FROM public.users LIMIT 5"
  }'
```

Response shape (simplified):

```json
{
	"columns": ["id", "email"],
	"rows": [{ "id": 1, "email": "a@example.com" }]
}
```

Errors return HTTP 400 with `{ "error": "..." }`. Rate limit: 120 requests per minute per key for reads, 60/min for the write endpoints above (HTTP 429).

### Example: run PRQL directly

```bash
curl -s http://localhost:3967/api/v1/prql \
  -H "Authorization: Bearer lp_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "my_postgres",
    "prql": "from users\nfilter active == true\ntake 10"
  }'
```

Lunapad compiles PRQL server-side, runs the resulting SQL, and returns the same result envelope as `/query`.

## MCP server (`/api/mcp`)

The same API keys work as bearer auth for an MCP client. Point any MCP client that supports streamable HTTP at `http://your-host:3967/api/mcp` with an `Authorization: Bearer <key>` header.

### Notebook authoring tools (new)

These mirror the AI chat agent's own tools — same blueprint/patch grammar, same 23-block dashboard/report vocabulary (grids, charts, metrics, pivot tables, callouts, tabs, filters, mermaid diagrams, and more), targeting `.luna` notebook files on disk instead of browser state.

| Tool | What it does | Scope |
| --- | --- | --- |
| `inspect_notebook` | Get a notebook's document + cells (real nodeIds for `operations`) | `workspace:read` |
| `validate_notebook` | Validate the on-disk document + live `$ref`s | `workspace:read` |
| `create_notebook` | Create a whole `.luna` notebook from a typed blueprint | `workspace:write` |
| `apply_notebook_patch` | Patch an existing notebook (blueprint / document / operations / rename) | `workspace:write` |
| `run_query_nodes` / `run_cells` | Execute cells by id (aliases of each other) | `workspace:write` |
| `pick_chart` | Run a cell, auto-pick a reasonable chart type from its result shape | `workspace:write` |
| `set_chart` | Explicitly set a cell's chart config | `workspace:write` |

Typical flow: `create_notebook` (or `inspect_notebook` + `apply_notebook_patch` for an existing one) → `run_query_nodes` → `validate_notebook` → done. A failed compile/patch returns repairable diagnostics instead of partially writing the file, so a calling agent can fix and retry in the same way the in-app AI chat does.

**Cell execution constraints, carried over from the rest of the automation API:**
- Query cells need an explicit `connectionId` pointing at an external connection (Postgres, ClickHouse, ...) — the built-in DuckDB-WASM connection is browser-only and cannot be run headlessly.
- Python cells execute via the same server-side interpreter the in-app Python cells use, but only for an **admin**-owned key (matches the existing `/api/python/*` policy — this is not loosened for automation). A non-admin key's `run_query_nodes`/`run_cells` call still runs any query/plot cells in the batch; Python cells in that batch fail with a clear permission error instead of executing.
- Plot cells execute their JS in a `node:vm` sandbox (fresh context, no `require`/`fetch`/`process`, disabled runtime code generation, 5s timeout) — a real isolation improvement over the browser's plain `new Function`, but Node's `vm` module is explicitly documented as not a hard security boundary. This is acceptable because callers are authenticated, scoped API keys, not arbitrary untrusted input — but don't hand out `workspace:write`-scoped keys to anyone you wouldn't trust to run JS on your server.

### Everything else

| Tool | What it does | Scope |
| --- | --- | --- |
| `list_connections` | List configured data sources | `connections:query` |
| `run_query` | Run SQL against a connection | `connections:query` |
| `run_prql` | Compile and run PRQL against a connection | `connections:query` |
| `list_notebooks` | List notebooks (project-folder mode) | `workspace:read` |
| `get_notebook` | Get one notebook's cells | `workspace:read` |
| `dbt_run` | Run dbt models | `dbt:run` |
| `dbt_compile` | Compile dbt models | `dbt:run` |
| `get_dbt_job_status` | Check a dbt job's status | `dbt:read` |
| `get_dbt_manifest` | Get the model graph | `dbt:read` |
| `list_shares` | List active published shares | `shares:read` |
| `publish_notebook` | Publish a notebook as a read-only share | `shares:publish` |
| `create_site_page` | Add a published share as a page on a site | `sites:manage` |

### Permission model

Every tool call is checked against **both** the caller's role (`can`) and, for API-key callers, the key's scopes (`hasApiScope`) — inside the tool handler itself, before it touches anything. A key that lacks the required scope, or whose owner's role doesn't allow the action, gets a `Forbidden` tool error naming the missing scope. There's no coarse per-path gate for `/api/mcp` the way there is for other routes — the router can't see which JSON-RPC tool a request is calling before dispatch, so enforcement happens per-tool instead.

## Next

[Self-hosting](11-self-hosting.md).
