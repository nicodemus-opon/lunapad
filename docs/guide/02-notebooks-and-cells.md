# Notebooks and cells

## The core idea

A notebook is a list of cells. A cell is either a query (PRQL, SQL, Python, or a visual pipeline), a user-defined function, or a block of markdown prose. Run a cell and its result shows up right below it, table or chart, like a Jupyter notebook for SQL.

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

`orders_clean` ran as a CTE inline. Nothing materialized, nothing to keep in sync by hand. This works across notebooks too when you're connected to an external data source: a cell in one notebook can reference another notebook's output name.

## Cell types

**Query cells** default to PRQL. Switch to SQL or open the visual pipeline builder from the cell header (see [Writing queries](03-writing-queries.md)). SQL cells get the same CTE auto-wiring but cannot enter GUI mode.

**Python cells** run on the server in an isolated interpreter (pandas, numpy, plotly, and friends are pre-installed in the Docker image). Output is stdout, any Plotly figures (matplotlib is not installed or captured), and errors. Python cells have an output name like query cells and can participate in the notebook dependency graph when they emit a dataframe.

**UDF cells** define a scalar function on the active connection (see [Writing queries](03-writing-queries.md)). Once saved, any query cell on that connection can call the function.

**Markdown cells** hold prose interleaved with query cells. They can embed live charts, tables, and metrics pulled from query results (see [Results, charts, and dashboards](05-results-charts-dashboards.md)).

## On disk

When a dbt project folder is open, notebooks are backed by real files. A notebook might be one `.luna` file (markdown and query cells in document order) or one file per model under `models/`. Cells inside an unpromoted `.luna` file are exploratory; promoted cells become real dbt models. See [dbt projects](08-dbt-projects.md).

## Running cells

Click run on a cell, or press Shift+Enter or Cmd/Ctrl+Enter while the cell is focused. If other cells depend on the one you just ran, Lunapad tells you how many downstream cells will also re-run, because their input just changed.

Cell status (running, succeeded, failed, how long it took) shows inline next to the cell. Errors point at the exact line and column that caused them.

**Run all** (⌘⇧R) executes every query cell in the notebook from top to bottom.

**Run above** / **Run below** (⌥⇧↑ / ⌥⇧↓ in command mode, or the cell ⋯ menu) run executable cells (query and Python) above or below the focused cell.

Use **Clear output** on a single cell from the ⋯ menu, or **Clear all results** from the Edit menu.

## Outline and navigation

The notebooks sidebar has **Browse** (folder tree) and **Outline** (table of contents). Switch with the toggle at the top of the panel, or press **⌘⇧O**. **View → Show outline** jumps there directly.

The outline is built from:

- Markdown headings (`#`, `##`, `###`, …) in prose cells
- Named query, Python, plot, and UDF cells (`outputName`)

Click an entry to scroll to that section. While you scroll, the outline highlights your current position. The command palette (⌘K) also lists outline entries for the active notebook.

## Status bar

When a notebook tab is open, a thin bar at the bottom of the editor shows the default connection, whether cells are running, the cell count, and how many query cells are stale (click **stale** to re-run them).

## Command mode

Click a cell's gutter or press Escape while editing to leave the Monaco editor and enter **command mode**. The cell gets a focus ring; keyboard shortcuts below apply to the focused cell without typing into the editor.

| Key       | Action                                       |
| --------- | -------------------------------------------- |
| Enter     | Open the editor (or expand a collapsed cell) |
| j / ↓     | Focus next cell                              |
| k / ↑     | Focus previous cell                          |
| a         | Insert cell above                            |
| b         | Insert cell below                            |
| d d       | Delete cell (press d twice)                  |
| c         | Collapse or expand cell                      |
| ⇧C        | Output-only view (query cells)               |
| ⇧J / ⇧K   | Move cell down / up                          |
| ⌥⇧↑ / ⌥⇧↓ | Run cells above / below (query & Python)     |
| y or ⌘C   | Copy cell                                    |
| p or ⌘V   | Paste cell below                             |
| ⌘⇧D       | Duplicate cell                               |

Press Escape from inside the editor to return to command mode.

## Cell menu

The ⋯ menu on each cell has duplicate, move up/down, run above/below, clear output, hide/show output, hide/show code, copy, paste, collapse, and (for `.luna` notebooks) **Promote to dbt model**. Right-click shortcuts match where possible.

Executable cells show a small **cell number** in the gutter (next to the run button). After multiple runs, the status line may show **×N** for how many times the cell has executed.

## Undo and redo

⌘Z undoes notebook structure changes (add, delete, move, paste). ⌘⇧Z or ⌘Y redoes. This is separate from Monaco's own undo inside the editor.

## Keyboard shortcuts (global)

| Shortcut | Action                                         |
| -------- | ---------------------------------------------- |
| ⌘K       | Command palette                                |
| ⌘J       | Toggle AI panel                                |
| ⌘B       | Toggle sidebar                                 |
| ⌘S       | Save notebook to disk (when a project is open) |
| ⌘⇧M      | Add markdown cell                              |
| ⌘⇧↵      | Add PRQL cell                                  |
| ⌘⇧C      | Open review thread on focused cell             |
| ⌘⇧R      | Run all cells                                  |
| ⌘1–9     | Switch notebook tab                            |
| ?        | Full shortcut list                             |

While editing a query cell: ⌘↵ or Shift+↵ runs the cell; ⌘⇧K opens inline AI; ⌘⇧L opens lineage for the cell's output name; ⌘⇧T runs dbt tests when the cell is a promoted model.

Press **?** any time for the complete list, including GUI stage menu and markdown formatting chords.

## Finding your way around

The command palette (⌘K) jumps to any notebook or cell by name and runs actions like "Run all cells" or "Toggle sidebar" without leaving the keyboard.

The sidebar lists notebooks (grouped by folder when a dbt project is open), the schema browser, and data sources.

## Next

[Writing queries](03-writing-queries.md) covers the ways to write a cell's logic.
