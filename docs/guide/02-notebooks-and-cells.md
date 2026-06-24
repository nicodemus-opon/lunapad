# Notebooks and cells

## The core idea

A notebook is a list of cells. A cell is either a query (PRQL, SQL, or a visual pipeline) or a block of markdown prose. Run a cell and its result shows up right below it, table or chart, like a Jupyter notebook for SQL.

The part that makes this more than a query runner: every query cell has an **output name**, set in a small field in the top-left of the cell. Write another cell that references that name as a table, and Lunapad treats it as a dependency automatically. No manual wiring.

```sql
-- cell: orders_clean
SELECT * FROM orders WHERE status = 'completed'
```

```prql
# cell: summary, references orders_clean
from orders_clean
aggregate { total = sum amount }
```

Running `summary` compiles to:

```sql
WITH orders_clean AS (
    SELECT * FROM orders WHERE status = 'completed'
)
SELECT SUM(amount) AS total FROM orders_clean
```

`orders_clean` ran as a CTE inline, nothing materialized, nothing to keep in sync by hand. This works across notebooks too when you're connected to an external data source: a cell in one notebook can reference another notebook's output name.

## Cell types

- **Query cells**, PRQL (default), SQL, or visual (a drag-and-drop pipeline builder, see [Writing queries](03-writing-queries.md)).
- **Markdown cells**, prose, interleaved with query cells. Can embed live charts, tables, and metrics pulled from query results (see [Results, charts, and dashboards](05-results-charts-dashboards.md)).

## Running cells

Click run on a cell, or use the keyboard shortcut shown in its tooltip (Shift+Enter or Cmd/Ctrl+Enter). If other cells depend on the one you just ran, Lunapad tells you how many downstream cells will also re-run, since their input just changed.

Cell status (running, succeeded, failed, how long it took) shows inline next to the cell, and errors point at the exact line and column that caused them.

## Finding your way around

Press Cmd/Ctrl+K to open the command palette. It jumps to any notebook or cell by name and runs quick actions like "Run all cells" or "Toggle sidebar" without leaving the keyboard.

## Next

[Writing queries](03-writing-queries.md) covers the three ways to actually write a cell's logic.
