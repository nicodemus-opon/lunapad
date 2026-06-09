# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, tailwindcss, sveltekit-adapter, mcp

---

## Commands

```bash
pnpm dev          # Start dev server (requires COOP/COEP headers — see vite.config.ts)
pnpm build        # Production build
pnpm test         # Run unit tests (vitest, files: src/**/*.test.ts)
pnpm test:e2e     # Run Playwright e2e tests (e2e/*.spec.ts)
pnpm check        # svelte-kit sync + svelte-check type checking
pnpm lint         # prettier --check
pnpm format       # prettier --write
```

Run a single test file: `pnpm vitest run src/lib/services/cell-deps.test.ts`

---

## Architecture

### What this is

Lunapad is a **notebook-style dbt IDE** that runs entirely as a SvelteKit SPA. Each notebook cell is a dbt model (PRQL or SQL). Cells reference each other by `outputName` and are assembled into a `WITH` CTE chain at query time — no actual dbt invocations happen for interactive runs.

### Data flow for cell execution

1. User writes PRQL or SQL in a cell (`Editor.svelte` / CodeMirror 6).
2. `notebook.svelte.ts:runCell()` calls `cell-deps.ts:buildExecutionCode()` (PRQL) or `buildSQLExecutionCode()` (SQL) to resolve upstream cell dependencies and inline them as CTEs.
3. For PRQL cells: the combined code is compiled to SQL via `prql.ts:compilePRQL()` (WASM, client-side). For SQL cells on external connections: CTEs are prepended directly.
4. SQL is dispatched to either DuckDB WASM (`duckdb.ts`) or an external connection via the `/api/connections/query` SvelteKit server route → `server/connections.ts`.
5. Results land on `cell.result` and render in `InlineResultView.svelte` (table/chart/stats).

### Central state

`src/lib/stores/notebook.svelte.ts` (~3600 lines) is the single source of truth. It holds all notebooks, cells, connections, tabs, dashboards, uploaded tables, and external schema. State is serialized to `localStorage` under `lunapad_notebook`. All mutations go through exported functions (`runCell`, `addCell`, `updateCellCode`, etc.).

### Key type boundaries

- `Cell` (in `notebook.svelte.ts`) — the core unit. Fields of note: `language: 'prql' | 'sql'`, `editMode: 'gui' | 'prql'`, `outputName` (used as CTE name), `compiledSQL`, `executionMs`, `result`.
- `Connection` (`src/lib/types/connection.ts`) — union of `DuckDBWASMConnection | PostgresConnection | ClickHouseConnection`. The built-in DuckDB connection has `id = 'builtin.duckdb'`.
- `GUIPipelineStage` (`src/lib/types/gui-pipeline.ts`) — union of all GUI stage types (From, Filter, Select, Derive, Group, Sort, Take, Join, Append, Window, Loop, Raw).

### PRQL compilation

`src/lib/services/prql.ts` wraps the `prqlc` WASM binary. `compilePRQL(query, target)` returns `{ sql, errors }`. Errors include `span: [from, to]` offsets used by `Editor.svelte` to render wavy underlines. A 200-entry LRU cache is in `notebook.svelte.ts` (`compilePRQLCached`).

For dbt on-disk compilation (`.prql` → `.sql`), see `src/lib/server/prql-compiler.ts`.

### Cell dependency resolution

`src/lib/services/cell-deps.ts` scans cell code for whole-word matches of other cells' `outputName`s to build a dependency graph. `buildExecutionCode` wraps deps as `let name = (...)` PRQL CTEs; `buildSQLExecutionCode` wraps them as SQL `WITH` clauses. For external connections, `buildGlobalExecutionCode` / `buildSQLGlobalExecutionCode` also search cross-notebook cells.

### GUI pipeline editor

`GUIEditor.svelte` renders a drag-drop pipeline of stage cards (SortableJS). `src/lib/services/gui-prql.ts` converts between `GUIPipelineStage[]` and PRQL text. SQL cells cannot enter GUI mode (early return in `requestGuiMode()` when `cell.language === 'sql'`).

### Editor

`src/lib/components/Editor.svelte` — CodeMirror 6, no Monaco. Uses `@codemirror/lang-sql` for syntax highlighting. Schema-aware completions are built from a `completions: string[]` prop (format: `"table.column"` pairs). Error underlines are applied via a `ViewPlugin` using `cm-prql-error` class.

### External connections

Schema fetch: `GET /api/connections/schema` → `server/connections.ts:fetchExternalConnectionSchema()`. Query execution: `POST /api/connections/query` → `queryExternalConnection()`. Postgres uses a pool (`pg` library, max 5 connections). ClickHouse uses its HTTP JSON API directly. Both enforce read-only SQL (`assertReadableSQL`).

### dbt integration

When a project folder is open, `server/dbt.ts` / `server/dbt-runner.ts` handle compile/run/test via subprocess calls to the `dbt` CLI. The manifest is parsed by `server/dbt-schema.ts` and surfaced through `/api/dbt/*` routes. Project file I/O goes through `/api/project/*` routes.

### Vite quirks

Two custom Vite plugins in `vite.config.ts`:
- `svelteNodeModulesStyleFix`: prevents `@tailwindcss/vite` from intercepting `<style>` blocks in node_modules Svelte files.
- `duckdbWorkerSourceMapFix`: strips a missing sourcemap reference from the DuckDB worker bundle.

The dev server requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers for DuckDB WASM SharedArrayBuffer support.

---

## Svelte MCP Server

The Svelte MCP server (`@sveltejs/mcp`) is configured in `.vscode/mcp.json` and provides comprehensive Svelte 5 and SvelteKit documentation.

### Available tools:

**list-sections** — Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths. When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

**get-documentation** — Retrieves full documentation content for specific sections. After calling list-sections, analyze the returned sections (especially use_cases) and fetch ALL relevant sections for the task.

**svelte-autofixer** — Analyzes Svelte code and returns issues and suggestions. Use this whenever writing Svelte code; keep calling until no issues or suggestions are returned.

**playground-link** — Generates a Svelte Playground link. Only call after user confirmation, and NEVER when code was written to project files.
