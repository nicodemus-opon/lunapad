import type { Cell } from '$lib/stores/notebook.svelte';
import { compileUdfFragment } from '$lib/services/udf';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A finished, nameable result a plot cell / GUI chart builder / Python cell
 *  can bind to by outputName — query cells (SQL/PRQL) and Python cells both
 *  expose `.result.rows/columns` in the same shape. */
export function isChartableSourceCell(cell: Cell): boolean {
	return (cell.cellType === 'query' || cell.cellType === 'python') && !!cell.outputName;
}

function indent(code: string): string {
	return code
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n');
}

// Strip {{ ref('name') }} → bare name so dbt Jinja doesn't reach the DB engine.
// SQL cells store refs intact on disk; this cleans them for execution.
const SQL_REF_RE = /\{\{\s*ref\('([^']+)'\)\s*\}\}/g;
function stripSqlRefs(code: string): string {
	return code.replace(SQL_REF_RE, '$1');
}

/**
 * If sql starts with a WITH clause, parse out the named CTE definitions and
 * the trailing main query (SELECT / INSERT / etc.).
 * Returns null when sql does not start with WITH.
 *
 * Handles nested parentheses inside CTE bodies correctly.
 */
function extractLeadingCTEs(
	sql: string
): { ctes: Array<{ name: string; body: string }>; mainQuery: string } | null {
	const trimmed = sql.trimStart();
	const withMatch = trimmed.match(/^WITH\s+/i);
	if (!withMatch) return null;

	let pos = withMatch[0].length;
	const ctes: Array<{ name: string; body: string }> = [];

	while (pos < trimmed.length) {
		// CTE name followed by optional whitespace/AS/(
		const nameMatch = trimmed.slice(pos).match(/^(\w+)\s+AS\s*\(\s*/i);
		if (!nameMatch) break;
		const cteName = nameMatch[1];
		pos += nameMatch[0].length;

		// Find the matching closing paren using depth counting
		let depth = 1;
		const bodyStart = pos;
		while (pos < trimmed.length && depth > 0) {
			if (trimmed[pos] === '(') depth++;
			else if (trimmed[pos] === ')') depth--;
			pos++;
		}
		const body = trimmed.slice(bodyStart, pos - 1).trim();
		ctes.push({ name: cteName, body });

		// Optional comma before next CTE
		const commaMatch = trimmed.slice(pos).match(/^\s*,\s*/);
		if (commaMatch) {
			pos += commaMatch[0].length;
		} else {
			break;
		}
	}

	const mainQuery = trimmed.slice(pos).trimStart();
	if (ctes.length === 0 || !mainQuery) return null;
	return { ctes, mainQuery };
}

/**
 * Assemble a final SQL string from upstream WITH parts and the cell's own code.
 * If the cell code itself starts with a WITH clause, its CTEs are merged into the
 * outer WITH chain (de-duplicated by name — upstream deps take priority) and only
 * the trailing SELECT is used as the final query body.
 * This prevents "WITH ... WITH ..." double-WITH syntax that DuckDB rejects.
 */
function assembleWithSQL(withParts: string[], cellCode: string): string {
	if (withParts.length === 0) return cellCode;

	const extracted = extractLeadingCTEs(cellCode);
	if (!extracted) {
		return `WITH ${withParts.join(',\n')}\n${cellCode}`;
	}

	// Merge inner CTEs, skipping any whose name is already defined by an upstream dep
	const existingNames = new Set(
		withParts.map((p) => {
			const m = p.match(/^(\w+)\s+AS\s*\(/i);
			return m ? m[1] : '';
		})
	);
	for (const cte of extracted.ctes) {
		if (!existingNames.has(cte.name)) {
			withParts.push(`${cte.name} AS (\n${indent(cte.body)}\n)`);
			existingNames.add(cte.name);
		}
	}

	return `WITH ${withParts.join(',\n')}\n${extracted.mainQuery}`;
}

/**
 * Returns all preceding query cells that cell[idx] transitively depends on,
 * in topological order (each dep before the cells that use it).
 * A cell "depends on" another if its code contains the other's outputName as a whole word.
 */
export function resolveDependencies(cells: Cell[], idx: number): Cell[] {
	const target = cells[idx];
	if (!target || target.cellType !== 'query') return [];

	// Only cells that come before the target and have an outputName can be deps.
	// UDF cells are included so SQL cells can reference a Python UDF by name,
	// exactly like a query cell's outputName.
	const byName = new Map<string, Cell>();
	for (let i = 0; i < idx; i++) {
		const c = cells[i];
		if ((c.cellType === 'query' || c.cellType === 'udf') && c.outputName) {
			byName.set(c.outputName, c);
		}
	}

	// Pre-compile all regexps once instead of recreating per visit() call.
	const reMap = new Map<string, RegExp>();
	for (const name of byName.keys()) {
		reMap.set(name, new RegExp(`\\b${escapeRegExp(name)}\\b`));
	}

	const ordered: Cell[] = [];
	const visited = new Set<string>();

	function visit(cell: Cell): void {
		if (visited.has(cell.id)) return;
		visited.add(cell.id);
		// Recurse into this cell's own dependencies first (post-order = topological)
		for (const [name, depCell] of byName) {
			if (reMap.get(name)!.test(cell.code)) {
				visit(depCell);
			}
		}
		ordered.push(cell);
	}

	// Seed from the target cell's direct dependencies
	for (const [name, depCell] of byName) {
		if (reMap.get(name)!.test(target.code)) {
			visit(depCell);
		}
	}

	return ordered;
}

/**
 * Returns true if cell[idx] has any resolved dependencies (i.e. references a
 * prior cell's outputName). Used to decide whether to use CTE execution.
 */
export function hasDependencies(cells: Cell[], idx: number): boolean {
	return resolveDependencies(cells, idx).length > 0;
}

/**
 * Emits a PRQL CTE binding for a dep cell.
 * SQL deps use an s-string so prqlc treats the raw SQL as a table expression,
 * which compiles correctly to all targets (DuckDB, Postgres, ClickHouse).
 *
 * UDF cells are not relations and can't be bound as a PRQL CTE — callers must
 * reject PRQL cells with a UDF dependency before reaching this point (see
 * notebook.svelte.ts's UDF compatibility check). Defensively emits nothing here.
 */
function prqlCteForDep(dep: Cell): string {
	if (dep.cellType === 'udf') return '';
	if (dep.language === 'sql') {
		// Escape any embedded double-quotes by doubling them (PRQL s-string escaping)
		const escaped = stripSqlRefs(dep.code.trim()).replace(/"/g, '""');
		return `let ${dep.outputName} = (s"${escaped}")`;
	}
	return `let ${dep.outputName} = (\n${indent(dep.code.trim())}\n)`;
}

/**
 * Builds the full PRQL string to execute for cell[idx].
 * Dependencies are wrapped as `let <name> = (...)` CTEs prepended to the cell's
 * own code, enabling Jupyter-like inter-cell references without requiring dbt.
 * SQL dep cells are injected via PRQL s-strings.
 *
 * If there are no dependencies, returns the cell's code unchanged.
 */
export function buildExecutionCode(cells: Cell[], idx: number): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';

	const deps = resolveDependencies(cells, idx);
	if (deps.length === 0) return cell.code;

	const cteParts = deps.map(prqlCteForDep);
	return [...cteParts, cell.code.trim()].join('\n\n');
}

/**
 * Builds the full SQL string to execute for a SQL cell[idx].
 * Each dep cell is compiled to SQL (PRQL deps via the provided compile function,
 * SQL deps use their code directly), then assembled into a WITH clause.
 *
 * Works uniformly across DuckDB, Postgres, and ClickHouse.
 *
 * @param compile - Function that compiles a PRQL string to SQL for the target dialect.
 *                  Returns null if compilation fails (that cell's dep is skipped).
 */
export function buildSQLExecutionCode(
	cells: Cell[],
	idx: number,
	compile: (prql: string) => string | null
): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';

	const deps = resolveDependencies(cells, idx);
	if (deps.length === 0) return stripSqlRefs(cell.code.trim());

	const withParts: string[] = [];
	for (const dep of deps) {
		if (dep.cellType === 'udf') {
			const fragment = compileUdfFragment(dep);
			if (typeof fragment === 'string') withParts.push(fragment);
			continue;
		}
		let depSQL: string | null;
		if (dep.language === 'sql') {
			depSQL = stripSqlRefs(dep.code.trim());
		} else {
			// Build the dep's own code with its own deps resolved
			const depIdx = cells.indexOf(dep);
			const depCode = depIdx >= 0 ? buildExecutionCode(cells, depIdx) : dep.code;
			depSQL = compile(depCode);
		}
		if (!depSQL) continue;
		withParts.push(`${dep.outputName} AS (\n${indent(depSQL)}\n)`);
	}

	if (withParts.length === 0) return stripSqlRefs(cell.code.trim());
	return assembleWithSQL(withParts, stripSqlRefs(cell.code.trim()));
}

/**
 * Returns the upstream **query** cells a plot cell references by outputName as
 * a whole word in its code (e.g. `top_products.rows`). Unlike
 * `resolveDependencies`, this is deliberately *not* transitive and the order
 * doesn't matter: a plot cell reading `top_products.rows` needs that cell's
 * already-computed `.result`, not `top_products`'s own upstream SQL
 * dependencies, since nothing is being concatenated into a query — it's a
 * direct read of a finished value. UDF cells are excluded (unlike
 * `resolveDependencies`, which includes them for SQL/PRQL CTE purposes) since
 * they have no `{rows, columns}`-shaped `.result` to bind.
 */
export function resolvePlotDataRefs(cells: Cell[], idx: number): Cell[] {
	const target = cells[idx];
	if (!target || target.cellType !== 'plot') return [];

	const byName = new Map<string, Cell>();
	for (let i = 0; i < idx; i++) {
		const c = cells[i];
		// 'python' included so a plot cell can chart a Python cell's DataFrame
		// result directly — buildPlotScope only reads `.result.rows/columns`,
		// which is cellType-agnostic.
		if (isChartableSourceCell(c)) byName.set(c.outputName, c);
	}

	const refs: Cell[] = [];
	for (const [name, cell] of byName) {
		if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(target.code)) refs.push(cell);
	}
	return refs;
}

/**
 * Returns the upstream **query** and **python** cells a python cell references
 * by outputName as a whole word in its code — e.g. `top_products.groupby(...)`.
 * Non-transitive and order-independent, same rationale as `resolvePlotDataRefs`:
 * a python cell reading `top_products` needs that cell's already-computed
 * `.result` (to bind as a DataFrame), not its own upstream SQL/PRQL dependencies.
 */
export function resolvePythonDataRefs(cells: Cell[], idx: number): Cell[] {
	const target = cells[idx];
	if (!target || target.cellType !== 'python') return [];

	const byName = new Map<string, Cell>();
	for (let i = 0; i < idx; i++) {
		const c = cells[i];
		if (isChartableSourceCell(c)) byName.set(c.outputName, c);
	}

	const refs: Cell[] = [];
	for (const [name, cell] of byName) {
		if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(target.code)) refs.push(cell);
	}
	return refs;
}

/**
 * Like `resolveDependencies` but also searches a global registry of cells from
 * other notebooks. Used for external connections (Postgres, ClickHouse) where
 * DuckDB views don't exist — all upstream cells from any notebook are inlined as
 * CTEs in a single compiled query.
 *
 * globalRegistry maps outputName → Cell for all notebooks. Same-notebook cells
 * appearing before idx take precedence over registry entries with the same name.
 */
export function resolveGlobalDependencies(
	cells: Cell[],
	idx: number,
	globalRegistry: Map<string, Cell>
): Cell[] {
	const target = cells[idx];
	if (!target || target.cellType !== 'query') return [];

	const byName = new Map<string, Cell>();
	// Same-notebook preceding cells take priority
	for (let i = 0; i < idx; i++) {
		const c = cells[i];
		if ((c.cellType === 'query' || c.cellType === 'udf') && c.outputName)
			byName.set(c.outputName, c);
	}
	// Fill in cross-notebook cells not already covered
	for (const [name, cell] of globalRegistry) {
		if (
			!byName.has(name) &&
			(cell.cellType === 'query' || cell.cellType === 'udf') &&
			cell.id !== target.id
		) {
			byName.set(name, cell);
		}
	}

	// Pre-compile all regexps once instead of recreating per visit() call.
	const reMap = new Map<string, RegExp>();
	for (const name of byName.keys()) {
		reMap.set(name, new RegExp(`\\b${escapeRegExp(name)}\\b`));
	}

	const ordered: Cell[] = [];
	const visited = new Set<string>();

	function visit(cell: Cell): void {
		if (visited.has(cell.id)) return;
		visited.add(cell.id);
		for (const [name, depCell] of byName) {
			if (reMap.get(name)!.test(cell.code)) visit(depCell);
		}
		ordered.push(cell);
	}

	for (const [name, depCell] of byName) {
		if (reMap.get(name)!.test(target.code)) visit(depCell);
	}

	return ordered;
}

/**
 * Like `buildExecutionCode` but uses `resolveGlobalDependencies` so cross-notebook
 * cells are also inlined as CTEs. Used for external connections.
 * SQL dep cells are injected via PRQL s-strings.
 */
export function buildGlobalExecutionCode(
	cells: Cell[],
	idx: number,
	globalRegistry: Map<string, Cell>
): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';

	const deps = resolveGlobalDependencies(cells, idx, globalRegistry);
	if (deps.length === 0) return cell.code;

	const cteParts = deps.map(prqlCteForDep);
	return [...cteParts, cell.code.trim()].join('\n\n');
}

/**
 * Like `buildSQLExecutionCode` but uses global dependency resolution across notebooks.
 * Used for SQL cells on external connections (Postgres, ClickHouse).
 */
export function buildSQLGlobalExecutionCode(
	cells: Cell[],
	idx: number,
	globalRegistry: Map<string, Cell>,
	compile: (prql: string) => string | null
): string {
	const cell = cells[idx];
	if (!cell || cell.cellType !== 'query') return '';

	const deps = resolveGlobalDependencies(cells, idx, globalRegistry);
	if (deps.length === 0) return stripSqlRefs(cell.code.trim());

	const withParts: string[] = [];
	for (const dep of deps) {
		if (dep.cellType === 'udf') {
			const fragment = compileUdfFragment(dep);
			if (typeof fragment === 'string') withParts.push(fragment);
			continue;
		}
		let depSQL: string | null;
		if (dep.language === 'sql') {
			depSQL = stripSqlRefs(dep.code.trim());
		} else {
			// Resolve dep's own global deps, then compile the combined PRQL
			const depIdx = cells.indexOf(dep);
			const depCode =
				depIdx >= 0 ? buildGlobalExecutionCode(cells, depIdx, globalRegistry) : dep.code;
			depSQL = compile(depCode);
		}
		if (!depSQL) continue;
		withParts.push(`${dep.outputName} AS (\n${indent(depSQL)}\n)`);
	}

	if (withParts.length === 0) return stripSqlRefs(cell.code.trim());
	return assembleWithSQL(withParts, stripSqlRefs(cell.code.trim()));
}
