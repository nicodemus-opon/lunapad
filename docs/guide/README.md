# Lunapad guide

Lunapad is a notebook-style SQL/PRQL IDE that doubles as a dbt project tool. Write a query, see results inline, chain queries together by name, and when a model is ready, turn it into a real dbt model on disk. It runs in your browser, against a built-in DuckDB engine or your own Postgres, ClickHouse, MySQL, Snowflake, and other sources.

This guide is for people running Lunapad, not for people building it. It assumes you've already got an instance up, or are about to start one.

On a shared deployment, everyone with an account sees the same notebooks, connections, and dbt project. Comments, roles, and workspace sync are built for that setup. See [Comments and review](13-comments-and-review.md) and [Self-hosting](11-self-hosting.md).

## Read in this order

1. [Getting started](01-getting-started.md): first run, login, sample data
2. [Notebooks and cells](02-notebooks-and-cells.md): the core mental model, command mode, keyboard shortcuts
3. [Writing queries](03-writing-queries.md): PRQL, SQL, Python, the visual builder, functions
4. [Connecting data](04-connecting-data.md): DuckDB, external sources, file uploads
5. [Results, charts, and dashboards](05-results-charts-dashboards.md): tables, stats, charts, reports
6. [Markdoc widget reference](06-markdoc-reference.md): full syntax for every report widget
7. [AI assistant](07-ai-assistant.md): conversational model building, inline edits, bring your own LLM
8. [dbt projects](08-dbt-projects.md): turning notebooks into a real dbt project
9. [Sharing and reports](09-sharing-and-reports.md): share links, multi-page sites, Evidence.dev
10. [API and MCP](10-automation-api.md): scripting Lunapad, hooking up Claude or other MCP clients
11. [Self-hosting](11-self-hosting.md): Docker Compose, environment variables, backups, roles
12. [FAQ and troubleshooting](12-faq-troubleshooting.md)
13. [Comments and review](13-comments-and-review.md): threads, inbox, team review on cells and shares

## Fastest path

```bash
docker compose up --build
```

Open `http://localhost:3967`, create the first account (it becomes admin), and run:

```sql
SELECT * FROM tpch.tiny.nation
```

You don't need to configure a data source first. See [Getting started](01-getting-started.md) for the full walkthrough.
