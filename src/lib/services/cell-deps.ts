import type { Cell } from '$lib/stores/notebook.svelte';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * Returns all preceding query cells that cell[idx] transitively depends on,
 * in topological order (each dep before the cells that use it).
 * A cell "depends on" another if its code contains the other's outputName as a whole word.
 */
export function resolveDependencies(cells: Cell[], idx: number): Cell[] {
	const target = cells[idx];
	if (!target || target.cellType !== 'query') return [];

	// Only cells that come before the target and have an outputName can be deps.
	const byName = new Map<string, Cell>();
	for (let i = 0; i < idx; i++) {
		const c = cells[i];
		if (c.cellType === 'query' && c.outputName) {
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
 */
function prqlCteForDep(dep: Cell): string {
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
	return `WITH ${withParts.join(',\n')}\n${stripSqlRefs(cell.code.trim())}`;
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
		if (c.cellType === 'query' && c.outputName) byName.set(c.outputName, c);
	}
	// Fill in cross-notebook cells not already covered
	for (const [name, cell] of globalRegistry) {
		if (!byName.has(name) && cell.cellType === 'query' && cell.id !== target.id) {
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
		let depSQL: string | null;
		if (dep.language === 'sql') {
			depSQL = stripSqlRefs(dep.code.trim());
		} else {
			// Resolve dep's own global deps, then compile the combined PRQL
			const depIdx = cells.indexOf(dep);
			const depCode =
				depIdx >= 0
					? buildGlobalExecutionCode(cells, depIdx, globalRegistry)
					: dep.code;
			depSQL = compile(depCode);
		}
		if (!depSQL) continue;
		withParts.push(`${dep.outputName} AS (\n${indent(depSQL)}\n)`);
	}

	if (withParts.length === 0) return stripSqlRefs(cell.code.trim());
	return `WITH ${withParts.join(',\n')}\n${stripSqlRefs(cell.code.trim())}`;
}
