# Dashboard AI — manual visual review checklist

Use this after automated graders and E2E pass, or when reviewing a new AI-generated dashboard markdown cell before publishing.

## Structure and hierarchy

- [ ] Clear title and optional status badge (`{% badge %}`) at the top
- [ ] KPI row (`{% grid %}` + `{% metric %}`) before detailed charts
- [ ] Charts and tables below metrics, not buried under long prose
- [ ] Tabs (`{% tabs %}`) used when there are 2+ distinct views (not one empty tab)

## Live data and accuracy

- [ ] No hardcoded numbers, dates, or category labels from query results
- [ ] All values use `$cell.field` or `{% metric value=$cell.field /%}`
- [ ] Currency uses `format="currency"` or `{% currency($cell.field) %}`
- [ ] Percents use columns already on 0–100 scale with `{% percent($cell.pct, 1) %}`

## Charts and tables

- [ ] Bar/line charts use sensible axes (dimension on x, measure on y)
- [ ] `{% chart ref=$cell %}` inherits cell chart config when available
- [ ] `{% datatable %}` limits rows (`limit=10`) for drill-down sections
- [ ] Multi-series charts specify `yColumns` when needed

## Dynamic behavior

- [ ] `{% filter kind="dropdown" %}` matches a parameterized cell (`\${param}` in SQL)
- [ ] Changing filter re-runs the downstream cell and updates numbers
- [ ] `{% progress value=... max=100 %}` uses an appropriate scale (e.g. quota attainment)
- [ ] `{% if gt($cell.count, 0) %}` or callouts handle empty/error upstream cells

## Polish and share-readiness

- [ ] No tool-call JSON, SQL blocks, or debug prose in the markdown cell
- [ ] No Markdoc parse errors or “Undefined variable” banners in preview
- [ ] Typography: short lead sentence, widgets carry detail (not a wall of text)
- [ ] Compare side-by-side with the **Sales Analytics Demo** dashboard cell

## Score targets (automated)

| Tier                  | `gradeDashboard` score | Notes                          |
| --------------------- | ---------------------- | ------------------------------ |
| Basic KPI + chart     | ≥ 70                   | grid, metric, chart            |
| Executive / tabs      | ≥ 75                   | tabs + multiple widgets        |
| Dynamic / interactive | ≥ 80                   | filter, progress, conditionals |

Run static graders: `pnpm vitest run src/lib/agent/evals/dashboard-adversarial.test.ts`

Run live API suite against local Ollama: `LLM_PROVIDER=ollama LLM_BASE_URL=http://127.0.0.1:11434 LLM_MODEL=gemma4:12b-mlx LUNAPAD_URL=http://localhost:5199 node scripts/ai-dashboard-adversarial.mjs`

Run E2E mock: `pnpm test:e2e:mock`

Run E2E LLM (optional): `LLM_PROVIDER=ollama LLM_BASE_URL=http://127.0.0.1:11434 LLM_MODEL=gemma4:12b-mlx pnpm test:e2e:llm`
