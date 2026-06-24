# Writing queries

Every query cell can be written three ways. Switch between them freely on the same cell, converting from one to another doesn't lose your logic.

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

Write plain SQL if you'd rather not use PRQL. SQL cells still get the CTE auto-wiring described in [Notebooks and cells](02-notebooks-and-cells.md), and still get schema-aware autocomplete. The only thing SQL cells can't do is enter the visual pipeline builder below.

## Visual pipeline builder

A drag-and-drop, no-code way to build the same kind of pipeline as PRQL, stage by stage. Useful if you don't want to write PRQL by hand, or want to hand a query off to someone who doesn't.

| Stage | What it does |
|---|---|
| From | Set or replace the source table |
| Filter | Keep rows that match conditions |
| Select | Choose columns to keep |
| Derive | Create computed columns |
| Group | Aggregate rows by keys |
| Window | Apply window expressions over sorted rows |
| Loop | Iteratively apply a PRQL loop body |
| Sort | Order rows by one or more columns |
| Take | Limit result row count |
| Join | Combine rows from another source |
| Append | Append rows from one or more sources |
| Raw | Drop in a raw block of PRQL inside the pipeline, for anything the other stages don't cover |

Stages stack as cards. Add, remove, and reorder them without touching code, and switch to the code view at any point to see (and edit) the exact PRQL the pipeline produces.

There's also a menu of ready-made multi-stage combinations for common patterns, so you don't build them stage by stage every time: top-N-by-metric, deduplicate by key, period-over-period variance, temporal trend rollups, and similar. Pick one as a starting point and adjust from there.

## Autocomplete and errors

Typing a table or column name brings up schema-aware completions, built from whatever connection the cell is targeting, including three-part names (`catalog.schema.table`) for external sources. PRQL compile errors show as wavy underlines directly on the offending code, not just in a separate error panel.

## User-defined functions

Write a small function once, in a Python-like signature, and reuse it across queries on the same connection:

```python
def discount_price(price: float, pct: float) -> float:
```

Type hints map to SQL types: `int` → bigint, `float` → double, `str` → varchar, `bool` → boolean, `datetime.date` → date, `datetime.datetime` → timestamp. Lunapad turns the signature into a real scalar function on the connection (a Trino UDF for external sources), so it's callable from any cell on that connection, not just the one it was defined in.

## Next

[Connecting data](04-connecting-data.md) covers where the tables in these queries actually come from.
