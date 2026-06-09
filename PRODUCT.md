# Product

## Register

brand

## Users

Data analysts and data engineers. Analysts want fast SQL iteration and inline results without a full dbt setup. Engineers want a model-graph IDE that integrates with their dbt project. Both groups are comfortable with SQL; neither wants another BI tool abstraction layer.

## Product Purpose

Lunapad is a SQL notebook where each cell is a data model. Cells reference each other by name; Studio resolves the dependency graph and assembles the CTE chain at runtime. The identity is "SQL notebook / data model IDE," not "dbt tool" or "PRQL tool" — dbt and PRQL are implementation details. Runs in the browser with no install; connects to local DuckDB WASM or external warehouses (Postgres, ClickHouse).

## Brand Personality

Sharp, nerdy, a little proud. Built by people who love SQL and are not apologizing for it.

## Anti-references

- BI tools (Looker, Tableau, Metabase): enterprise-blue palettes, chart-dashboard heroes, corporate softening of technical vocabulary.
- Terminal / hacker aesthetic: green-on-black, ASCII borders, retro novelty.
- Existing brand tokens: do not replace the color system (dark warm neutrals + cyan primary in OKLCH).

## Design Principles

1. **The tool is the hero.** Show the product working. The notebook preview IS the proof; never bury it or replace it with an abstraction.
2. **Technical without apology.** Use SQL vocabulary precisely. Don't soften "model" into "insight" or "pipeline" into "workflow step."
3. **Hierarchy from what matters, not from template.** No eyebrows above every section, no numbered scaffold on every heading. Structure from importance.
4. **Confident, not loud.** Capability speaks. No buzzwords, no enterprise-grade / seamless / supercharge language.
5. **Speed is a design material.** Every visual decision — spacing, weight contrast, motion timing — should reinforce that this tool is fast and precise.

## Accessibility & Inclusion

WCAG AA minimum. Reduced motion already handled in existing CSS. Both light and dark mode supported in the app; landing page is always dark.
