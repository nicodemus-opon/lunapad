# Getting started

## Run it

```bash
docker compose up --build   # first run, builds the app image (a few minutes)
docker compose up -d        # subsequent starts
```

This starts four services:

| Service | What it's for | URL |
|---|---|---|
| Lunapad | the app | http://localhost:3967 |
| Trino | query engine for external data sources | http://localhost:8067 |
| Postgres | shared workspace, accounts, connection secrets | localhost:5432 |
| Inngest | scheduler for cron model runs | http://localhost:8267 |

Trino takes about a minute to finish starting. The app won't serve requests until Trino reports healthy, so the first `docker compose up` will sit for a bit before Lunapad responds. Run `docker compose ps` to check status, everything should say `healthy`.

## First login

Open `http://localhost:3967`. You'll land on a setup screen asking you to create an account. The first account you create becomes the admin, and signup closes immediately after, so nobody else can self-register. The admin adds teammates later from Settings → Team (covered in [self-hosting](11-self-hosting.md)).

After that, every visit goes through a normal login.

![A Lunapad notebook open in the browser, with the sidebar listing notebooks grouped into folders and a query cell showing results below it](images/01-notebook-view.png)

## Try a query without setting anything up

Lunapad ships with a sample dataset wired up out of the box. Open a notebook, add a cell, and run:

```sql
SELECT * FROM tpch.tiny.nation
SELECT * FROM tpch.tiny.orders LIMIT 100
```

`tpch` is a built-in Trino catalog, no connection setup needed. A second catalog, `docker_postgres`, points at the bundled Postgres instance and has the same `tpch.tiny.*` tables, useful for trying out cross-source joins immediately (see [Connecting data](04-connecting-data.md)).

You can also just write to the built-in DuckDB engine with no catalog prefix at all, that's the default connection for any new cell.

## Other ways to run it

**Desktop app.** Lunapad also ships as a native desktop app (Tauri-based) if you'd rather not run Docker. Functionality is the same; external data sources still need Trino running somewhere reachable.

**Local development.** If you're modifying Lunapad itself rather than just using it, see the repository's main `README.md` for `pnpm dev` instructions.

## Next

[Notebooks and cells](02-notebooks-and-cells.md) covers how to actually work in the app once you're logged in.
