# Lunapad

A notebook-style IDE for [PRQL](https://prql-lang.org/) and SQL that runs in the browser. Cells reference each other by name and compile to a `WITH` chain at query time.

Engines:

- DuckDB WASM for local queries, zero config
- Trino for external sources (Postgres, ClickHouse, MySQL)

For usage see the [user guide](docs/guide/README.md). This README covers running and developing Lunapad.

## Run with Docker

Starts Lunapad, Trino, Postgres, and Inngest. App opens at http://localhost:3000.

```bash
docker compose up --build
docker compose up -d     # later starts
docker compose down      # stop, keep data
docker compose down -v   # stop and wipe data
```

Trino takes about 60s on first start. Sample data is ready at `tpch.tiny.*`.

Cloud and demo variants are documented in [self-hosting](docs/guide/11-self-hosting.md).

## Local development

Requires Node 22, pnpm 9, and Trino running (use the Docker infra above).

```bash
pnpm install
pnpm dev  # http://localhost:5173
```

Point local dev at Docker infra:

```bash
TRINO_URL=http://localhost:8080 \
TRINO_CATALOG_DIR=./trino/catalog \
INNGEST_BASE_URL=http://localhost:8288 \
INNGEST_EVENT_KEY=local \
INNGEST_SIGNING_KEY=local \
pnpm dev
```

Other commands: `pnpm build`, `pnpm test`, `pnpm test:e2e`, `pnpm check`, `pnpm lint`.

## Docs

- [User guide](docs/guide/README.md)
- [Self-hosting](docs/guide/11-self-hosting.md)
