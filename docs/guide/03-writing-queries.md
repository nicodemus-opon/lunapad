# Writing queries

Every query cell can be written three ways (four if you count Python). Switch between PRQL, SQL, and GUI on the same cell; Lunapad converts when it can.

## PRQL (default)

[PRQL](https://prql-lang.org/) is a pipeline-style query language that compiles to SQL. It reads top to bottom, each line transforming the result of the line before it:

```prql
from orders
filter status == "completed"
group customer_id (
    aggregate { total = sum amount }
)
sort {-total}
take 10
```

Lunapad compiles PRQL to SQL client-side as you type. A preview panel shows the compiled SQL, and compile errors underline the exact span of PRQL that caused them.

## SQL

Write plain SQL if you'd rather not use PRQL. SQL cells still get the CTE auto-wiring described in [Notebooks and cells](02-notebooks-and-cells.md), and still get schema-aware autocomplete. SQL cells cannot enter the visual pipeline builder.

## Visual pipeline builder

The GUI builds the same kind of pipeline as PRQL, stage by stage. Hand a cell to someone who doesn't write PRQL: they can drag stages, you can switch to code view and edit the generated PRQL yourself.

| Stage  | What it does                                                                               |
| ------ | ------------------------------------------------------------------------------------------ |
| From   | Set or replace the source table                                                            |
| Filter | Keep rows that match conditions                                                            |
| Select | Choose columns to keep                                                                     |
| Derive | Create computed columns                                                                    |
| Group  | Aggregate rows by keys                                                                     |
| Window | Apply window expressions over sorted rows                                                  |
| Loop   | Iteratively apply a PRQL loop body                                                         |
| Sort   | Order rows by one or more columns                                                          |
| Take   | Limit result row count                                                                     |
| Join   | Combine rows from another source                                                           |
| Append | Append rows from one or more sources                                                       |
| Raw    | Drop in a raw block of PRQL inside the pipeline, for anything the other stages don't cover |

Stages stack as cards. Add, remove, and reorder them without touching code.

Press **/** while a GUI cell is focused (command mode) to open the **Add Stage** menu. Type to filter, Enter to pick, Escape to close.

There's also a menu of ready-made multi-stage combinations: top-N-by-metric, deduplicate by key, period-over-period variance, temporal trend rollups, and similar. Pick one as a starting point and adjust.

**When GUI conversion stops.** SQL cells never enter GUI mode. Inside a GUI pipeline, anything that doesn't map cleanly to a stage goes in a **Raw** stage. Complex window expressions or nested logic may be easier to write in PRQL and switch back to GUI only for the simple parts.

**Column chips.** Filter, derive, and join stages use chip inputs that know your schema: type-aware suggestions, three-part names for external catalogs, and validation before you run.

## Python

Python cells run server-side. The Docker image ships with pandas, numpy, pyarrow, and plotly; local installs bootstrap a venv on first use.

Typical pattern: pull a table with the connection helpers Lunapad injects, transform in pandas, assign to a variable Lunapad picks up as the cell output. Stdout and figures render below the cell. Errors show a traceback.

Use Python when you need a library SQL doesn't have, or when you're prototyping a transform before rewriting it as SQL. Downstream PRQL/SQL cells can reference a Python cell's output name once it produces a result set.

## Autocomplete and errors

Typing a table or column name brings up schema-aware completions from whatever connection the cell is targeting, including three-part names (`catalog.schema.table`) for external sources. SQL autocomplete is context-aware:

- **Scoped columns** — in `SELECT`, `WHERE`, `GROUP BY`, etc., columns from tables already in `FROM`/`JOIN` rank first.
- **JOIN completion** — after `JOIN`, suggestions can include the target table plus an `ON` clause inferred from foreign keys (when the catalog exposes them) or column naming patterns like `customer_id`.
- **INSERT/UPDATE** — `INSERT INTO table` offers a column list snippet; `UPDATE … SET` suggests columns from that table.
- **Table aliases** — completing a table in `FROM`/`JOIN` may offer a variant with a short alias (`orders o`).
- **Fuzzy matching** — camelCase initials (`oId` → `orderId`) and underscore tokens (`ord_am` → `order_amount`) work alongside prefix match.

External connections execute through Trino, so function and keyword suggestions reflect Trino SQL. The built-in DuckDB connection uses DuckDB-native builtins.

PRQL compile errors show as wavy underlines on the offending code, not just in a separate error panel.

## User-defined functions

Write a small function once, in a Python-like signature, and reuse it across queries on the same connection:

```python
def discount_price(price: float, pct: float) -> float:
```

Type hints map to SQL types: `int` → bigint, `float` → double, `str` → varchar, `bool` → boolean, `datetime.date` → date, `datetime.datetime` → timestamp. Lunapad turns the signature into a real scalar function on the connection (a Trino UDF for external sources), so it's callable from any cell on that connection, not just the one it was defined in.

## Next

[Connecting data](04-connecting-data.md) covers where the tables in these queries actually come from.
