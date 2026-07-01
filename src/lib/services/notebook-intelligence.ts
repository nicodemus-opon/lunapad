import { coerceNumber } from '$lib/utils';
import { findSemanticDeriveCandidates } from '$lib/services/semantic-derive';

export interface SchemaTable {
	name: string;
	schema?: string;
	columns: string[];
	columnTypes: string[];
}

export interface ColumnProfile {
	name: string;
	nullRatio: number;
	distinctCount: number;
	sampleValues: string[];
	kind: 'numeric' | 'date' | 'boolean' | 'text';
}

export interface DataQualityCheck {
	id: string;
	label: string;
	status: 'pass' | 'warn';
	detail: string;
}

export interface PerformanceAdvice {
	severity: 'info' | 'warn';
	headline: string;
	actions: string[];
}

export interface JoinSuggestion {
	leftTable: string;
	rightTable: string;
	leftColumn: string;
	rightColumn: string;
	reason: string;
}

export interface SemanticMatch {
	table: string;
	score: number;
	reason: string;
}

export interface NotebookIntelligence {
	generatedAt: number;
	connectionId: string;
	rowCount: number;
	columnCount: number;
	columnProfiles: ColumnProfile[];
	dataQuality: DataQualityCheck[];
	performance: PerformanceAdvice[];
	queryRepair: string[];
	nextAnalyses: string[];
	joinSuggestions: JoinSuggestion[];
	semanticMatches: SemanticMatch[];
}

export type NotebookActionKind =
	| 'apply-repair-replacement'
	| 'apply-repair-alias'
	| 'apply-repair-cast'
	| 'add-filter-stage'
	| 'add-take-stage'
	| 'add-select-stage'
	| 'materialize-cell'
	| 'run-cell-and-downstream'
	| 'set-schedule-segment'
	| 'open-chart-recommended'
	| 'insert-join-stage'
	| 'branch-top-contributors';

export interface NotebookAction {
	id: string;
	kind: NotebookActionKind;
	label: string;
	detail: string;
	priority: number;
	payload?: Record<string, string | number | boolean | null>;
}

export interface NotebookActionFeedbackStats {
	acceptedByActionId?: Record<string, number>;
	dismissedByActionId?: Record<string, number>;
}

function normalizeName(table: SchemaTable): string {
	return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9_\.]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
}

function detectKind(values: unknown[]): ColumnProfile['kind'] {
	const samples = values.filter((value) => value !== null && value !== undefined).slice(0, 40);
	if (samples.length === 0) return 'text';
	if (samples.some((value) => typeof value === 'boolean')) return 'boolean';
	if (samples.some((value) => value instanceof Date)) return 'date';

	const dateHits = samples.filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value))).length;
	if (dateHits / samples.length >= 0.7) return 'date';

	const numericHits = samples.filter((value) => coerceNumber(value) !== null).length;
	if (numericHits / samples.length >= 0.7) return 'numeric';

	return 'text';
}

function profileColumns(rows: Record<string, unknown>[], columns: string[]): ColumnProfile[] {
	const rowCount = rows.length || 1;
	return columns.map((column) => {
		const values = rows.map((row) => row[column]);
		const nonNull = values.filter((value) => value !== null && value !== undefined);
		const nullCount = values.length - nonNull.length;
		const distinctCount = new Set(nonNull.map((value) => String(value))).size;
		const sampleValues = [...new Set(nonNull.map((value) => String(value)).slice(0, 5))];
		return {
			name: column,
			nullRatio: nullCount / rowCount,
			distinctCount,
			sampleValues,
			kind: detectKind(values)
		};
	});
}

function buildDataQualityChecks(
	rows: Record<string, unknown>[],
	profiles: ColumnProfile[]
): DataQualityCheck[] {
	const checks: DataQualityCheck[] = [];
	const rowCount = rows.length;

	const heavyNulls = profiles.filter((profile) => profile.nullRatio >= 0.3);
	checks.push({
		id: 'null-threshold',
		label: 'Null threshold',
		status: heavyNulls.length > 0 ? 'warn' : 'pass',
		detail:
			heavyNulls.length > 0
				? `${heavyNulls.map((profile) => profile.name).join(', ')} exceed 30% nulls`
				: 'All columns are below 30% nulls'
	});

	const uniqueCandidate = profiles.find(
		(profile) =>
			profile.distinctCount === rowCount &&
			rowCount > 0 &&
			/(^id$|_id$|uuid|key)/i.test(profile.name)
	);
	checks.push({
		id: 'unique-key',
		label: 'Unique key candidate',
		status: uniqueCandidate ? 'pass' : 'warn',
		detail: uniqueCandidate
			? `${uniqueCandidate.name} looks unique across ${rowCount} rows`
			: 'No obvious unique key column detected'
	});

	const staleDate = profiles.find(
		(profile) => profile.kind === 'date' && profile.sampleValues.length > 0
	);
	checks.push({
		id: 'freshness-signal',
		label: 'Freshness signal',
		status: staleDate ? 'pass' : 'warn',
		detail: staleDate
			? `Date-like column detected: ${staleDate.name}`
			: 'No date column found for freshness checks'
	});

	return checks;
}

function buildPerformanceAdvice(input: {
	executionMs: number | null;
	rowCount: number;
	columnCount: number;
	code: string;
}): PerformanceAdvice[] {
	const advice: PerformanceAdvice[] = [];
	if ((input.executionMs ?? 0) > 2_000) {
		advice.push({
			severity: 'warn',
			headline: 'Execution took more than 2 seconds',
			actions: [
				'Add a filter earlier in the pipeline',
				'Materialize this intermediate result if reused'
			]
		});
	}
	if (input.rowCount > 50_000) {
		advice.push({
			severity: 'warn',
			headline: 'Large result set returned',
			actions: ['Use take to inspect fewer rows', 'Aggregate before visualization']
		});
	}
	if (input.columnCount > 20) {
		advice.push({
			severity: 'info',
			headline: 'Wide result shape',
			actions: ['Select only columns needed downstream']
		});
	}
	if (!/\b(filter|where)\b/i.test(input.code) && input.rowCount > 2_000) {
		advice.push({
			severity: 'info',
			headline: 'No filter detected in query',
			actions: ['Add filter predicates to reduce scan and transfer cost']
		});
	}
	return advice;
}

function nearestToken(value: string, candidates: string[]): string | null {
	if (!value || candidates.length === 0) return null;
	let best: { word: string; score: number } | null = null;
	for (const candidate of candidates) {
		const distance =
			Math.abs(candidate.length - value.length) + (candidate.includes(value[0]) ? 0 : 1);
		if (!best || distance < best.score) best = { word: candidate, score: distance };
	}
	return best?.word ?? null;
}

function buildQueryRepairHints(errorMessages: string[], schemaTables: SchemaTable[]): string[] {
	const hints = new Set<string>();
	const allColumns = schemaTables.flatMap((table) => table.columns);
	const allTables = schemaTables.map((table) => normalizeName(table));
	for (const message of errorMessages) {
		const lower = message.toLowerCase();
		const missingColumnMatch = lower.match(
			/column\s+"?([a-z0-9_\.]+)"?\s+(does not exist|not found)/i
		);
		if (missingColumnMatch) {
			const candidate = nearestToken(missingColumnMatch[1], allColumns);
			if (candidate)
				hints.add(`Unknown column '${missingColumnMatch[1]}'. Did you mean '${candidate}'?`);
		}
		const missingTableMatch = lower.match(
			/table\s+"?([a-z0-9_\.]+)"?\s+(does not exist|not found)/i
		);
		if (missingTableMatch) {
			const candidate = nearestToken(missingTableMatch[1], allTables);
			if (candidate) hints.add(`Unknown table '${missingTableMatch[1]}'. Try '${candidate}'.`);
		}
		if (lower.includes('ambiguous')) {
			hints.add('Use explicit table aliases to disambiguate duplicate column names.');
		}
		if (lower.includes('type') && lower.includes('cannot')) {
			hints.add('Check type mismatches and add explicit casts where needed.');
		}
	}
	return [...hints].slice(0, 5);
}

function buildNextAnalyses(profiles: ColumnProfile[]): string[] {
	const ideas: string[] = [];
	const numeric = profiles
		.filter((profile) => profile.kind === 'numeric')
		.map((profile) => profile.name);
	const date = profiles.find((profile) => profile.kind === 'date')?.name;
	const text = profiles.filter((profile) => profile.kind === 'text').map((profile) => profile.name);
	const deriveCandidates = findSemanticDeriveCandidates(
		profiles.map((profile) => ({
			name: profile.name,
			kind: profile.kind,
			nullRatio: profile.nullRatio,
			distinctCount: profile.distinctCount,
			confidence: 0.6
		}))
	);
	const composed = deriveCandidates.find((candidate) => candidate.pattern === 'composed_metric');
	const flow = deriveCandidates.find((candidate) => candidate.pattern === 'flow_delta');
	const efficiency = deriveCandidates.find((candidate) => candidate.pattern === 'efficiency_ratio');
	const businessDimensions = profiles
		.filter((profile) => profile.kind === 'text')
		.map((profile) => profile.name)
		.filter((name) =>
			/(category|segment|location|region|country|city|customer\s*type|channel|type|status)/i.test(
				name
			)
		);
	const bestDimension = businessDimensions[0] ?? text[0];

	if (composed) {
		ideas.push(`Revenue analysis: derive ${composed.leftColumn} * ${composed.rightColumn}`);
		if (bestDimension) {
			ideas.push(`Revenue by ${bestDimension}: aggregate derived revenue by ${bestDimension}`);
		}
		if (date) {
			ideas.push(`Daily revenue trend: aggregate derived revenue by ${date}`);
		}
	}
	if (flow) {
		ideas.push(`Net flow analysis: derive ${flow.leftColumn} - ${flow.rightColumn}`);
	}
	if (efficiency) {
		ideas.push(`Efficiency analysis: derive ${efficiency.leftColumn} / ${efficiency.rightColumn}`);
	}

	if (date && numeric.length > 0) {
		ideas.push(`Trend over time: aggregate ${numeric[0]} by ${date}`);
	}
	if (bestDimension && numeric.length > 0) {
		ideas.push(`Top contributors: rank ${bestDimension} by ${numeric[0]}`);
	}
	if (numeric.length > 1) {
		ideas.push(`Correlation check: compare ${numeric[0]} and ${numeric[1]}`);
	}
	if (numeric.length > 0) {
		ideas.push(`Outlier scan: check ${numeric[0]} beyond IQR bounds`);
	}
	if (ideas.length === 0) {
		ideas.push('Inspect value counts for the leading categorical column');
	}
	return [...new Set(ideas)].slice(0, 4);
}

function buildJoinSuggestions(schemaTables: SchemaTable[]): JoinSuggestion[] {
	const suggestions: JoinSuggestion[] = [];
	for (let i = 0; i < schemaTables.length; i++) {
		for (let j = i + 1; j < schemaTables.length; j++) {
			const left = schemaTables[i];
			const right = schemaTables[j];
			for (const leftCol of left.columns) {
				for (const rightCol of right.columns) {
					const direct = leftCol === rightCol && /(^id$|_id$)/i.test(leftCol);
					const ref = leftCol.endsWith('_id') && rightCol === 'id';
					const reverseRef = rightCol.endsWith('_id') && leftCol === 'id';
					if (!(direct || ref || reverseRef)) continue;
					suggestions.push({
						leftTable: normalizeName(left),
						rightTable: normalizeName(right),
						leftColumn: leftCol,
						rightColumn: rightCol,
						reason: direct ? 'Shared id-style column name' : 'Foreign-key style id column'
					});
					if (suggestions.length >= 6) return suggestions;
				}
			}
		}
	}
	return suggestions;
}

function scoreSemanticMatch(query: string, table: SchemaTable): SemanticMatch | null {
	const tokens = tokenize(query);
	if (tokens.length === 0) return null;
	const tableName = normalizeName(table).toLowerCase();
	const haystack = `${tableName} ${table.columns.join(' ').toLowerCase()}`;
	let score = 0;
	for (const token of tokens) {
		if (tableName.includes(token)) score += 3;
		else if (haystack.includes(token)) score += 1;
	}
	if (score === 0) return null;
	return {
		table: normalizeName(table),
		score,
		reason: score >= 5 ? 'Strong match with table and column names' : 'Partial schema token match'
	};
}

function buildSemanticMatches(query: string, schemaTables: SchemaTable[]): SemanticMatch[] {
	return schemaTables
		.map((table) => scoreSemanticMatch(query, table))
		.filter((match): match is SemanticMatch => Boolean(match))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);
}

export function buildNotebookIntelligence(input: {
	connectionId: string;
	code: string;
	rows: Record<string, unknown>[];
	columns: string[];
	executionMs: number | null;
	errors: string[];
	schemaTables: SchemaTable[];
}): NotebookIntelligence {
	const columnProfiles = profileColumns(input.rows, input.columns);
	return {
		generatedAt: Date.now(),
		connectionId: input.connectionId,
		rowCount: input.rows.length,
		columnCount: input.columns.length,
		columnProfiles,
		dataQuality: buildDataQualityChecks(input.rows, columnProfiles),
		performance: buildPerformanceAdvice({
			executionMs: input.executionMs,
			rowCount: input.rows.length,
			columnCount: input.columns.length,
			code: input.code
		}),
		queryRepair: buildQueryRepairHints(input.errors, input.schemaTables),
		nextAnalyses: buildNextAnalyses(columnProfiles),
		joinSuggestions: buildJoinSuggestions(input.schemaTables),
		semanticMatches: buildSemanticMatches(input.code, input.schemaTables)
	};
}

export function extractTablesTouched(code: string): string[] {
	const matches = [...code.matchAll(/\b(from|join)\s+([a-zA-Z0-9_\.]+)/gi)];
	const names = matches.map((match) => match[2]);
	return [...new Set(names)].slice(0, 12);
}

function pushAction(buffer: NotebookAction[], action: NotebookAction): void {
	if (buffer.some((entry) => entry.id === action.id)) return;
	buffer.push(action);
}

function parseReplacementHint(hint: string): { from: string; to: string } | null {
	const columnMatch = hint.match(/Unknown column '([^']+)'\. Did you mean '([^']+)'\?/i);
	if (columnMatch?.[1] && columnMatch?.[2]) {
		return { from: columnMatch[1], to: columnMatch[2] };
	}
	const tableMatch = hint.match(/Unknown table '([^']+)'\. Try '([^']+)'\./i);
	if (tableMatch?.[1] && tableMatch?.[2]) {
		return { from: tableMatch[1], to: tableMatch[2] };
	}
	return null;
}

function firstColumnByKind(profiles: ColumnProfile[], kind: ColumnProfile['kind']): string | null {
	const candidate = profiles.find((profile) => profile.kind === kind && profile.nullRatio <= 0.85);
	return candidate?.name ?? null;
}

function firstLikelyDimension(profiles: ColumnProfile[]): string | null {
	const candidates = profiles
		.filter((profile) => {
			if (profile.kind !== 'text') return false;
			if (profile.distinctCount < 2) return false;
			if (profile.distinctCount > 300) return false;
			if (profile.nullRatio > 0.8) return false;
			return true;
		})
		.map((profile) => {
			let score = 0;
			if (
				/(category|segment|location|region|country|city|customer\s*type|channel|status|type)/i.test(
					profile.name
				)
			)
				score += 4;
			if (/(name|title|label)/i.test(profile.name)) score -= 1.5;
			if (profile.distinctCount <= 60) score += 1.5;
			if (profile.distinctCount > 180) score -= 0.8;
			return { profile, score };
		})
		.sort((a, b) => b.score - a.score);

	return candidates[0]?.profile.name ?? null;
}

function actionCategory(
	kind: NotebookActionKind
): 'repair' | 'cost' | 'run' | 'shape' | 'insight' | 'branch' {
	if (
		kind === 'apply-repair-replacement' ||
		kind === 'apply-repair-alias' ||
		kind === 'apply-repair-cast'
	)
		return 'repair';
	if (kind === 'materialize-cell') return 'cost';
	if (kind === 'run-cell-and-downstream' || kind === 'set-schedule-segment') return 'run';
	if (
		kind === 'add-filter-stage' ||
		kind === 'add-take-stage' ||
		kind === 'add-select-stage' ||
		kind === 'insert-join-stage'
	) {
		return 'shape';
	}
	if (kind === 'open-chart-recommended') return 'insight';
	return 'branch';
}

function feedbackAdjustedPriority(
	action: NotebookAction,
	feedback: NotebookActionFeedbackStats | undefined
): number {
	const accepted = Number(feedback?.acceptedByActionId?.[action.id] ?? 0);
	const dismissed = Number(feedback?.dismissedByActionId?.[action.id] ?? 0);
	return action.priority + accepted * 2.2 - dismissed * 1.6;
}

function diversifyRankedActions(
	actions: NotebookAction[],
	feedback: NotebookActionFeedbackStats | undefined
): NotebookAction[] {
	const ranked = actions
		.map((action) => ({ action, score: feedbackAdjustedPriority(action, feedback) }))
		.sort((a, b) => b.score - a.score);

	const selected: NotebookAction[] = [];
	const categoryCounts = new Map<string, number>();

	for (const candidate of ranked) {
		if (selected.length >= 12) break;
		const category = actionCategory(candidate.action.kind);
		const count = categoryCounts.get(category) ?? 0;
		if (count >= 3) continue;
		selected.push(candidate.action);
		categoryCounts.set(category, count + 1);
	}

	if (selected.length >= 12) return selected;
	for (const candidate of ranked) {
		if (selected.length >= 12) break;
		if (selected.some((entry) => entry.id === candidate.action.id)) continue;
		selected.push(candidate.action);
	}

	return selected;
}

export function recommendNotebookActions(input: {
	code: string;
	intelligence: NotebookIntelligence | null;
	runImpact: { segmentCount: number; downstreamCount: number };
	isGuiMode: boolean;
	hasResult: boolean;
	feedback?: NotebookActionFeedbackStats;
}): NotebookAction[] {
	const intelligence = input.intelligence;
	if (!intelligence) return [];

	const actions: NotebookAction[] = [];

	for (const hint of intelligence.queryRepair) {
		const replacement = parseReplacementHint(hint);
		if (replacement) {
			pushAction(actions, {
				id: `repair:${replacement.from}->${replacement.to}`,
				kind: 'apply-repair-replacement',
				label: `Fix ${replacement.from}`,
				detail: `Replace ${replacement.from} with ${replacement.to}`,
				priority: 100,
				payload: { from: replacement.from, to: replacement.to }
			});
		}
		if (/disambiguate duplicate column names/i.test(hint) || /explicit table aliases/i.test(hint)) {
			pushAction(actions, {
				id: 'repair:alias-disambiguation',
				kind: 'apply-repair-alias',
				label: 'Apply alias disambiguation',
				detail: 'Add a table alias to the from stage to reduce ambiguous references',
				priority: 96
			});
		}
		if (/type mismatch|explicit casts/i.test(hint)) {
			pushAction(actions, {
				id: 'repair:type-cast',
				kind: 'apply-repair-cast',
				label: 'Insert cast template',
				detail: 'Add a derive cast template to resolve type mismatches quickly',
				priority: 94
			});
		}
	}

	const hasPerfWarn = intelligence.performance.some((item) => item.severity === 'warn');
	const hasLargeResult = intelligence.rowCount > 50_000;
	if (input.isGuiMode && (hasPerfWarn || hasLargeResult)) {
		const numeric = firstColumnByKind(intelligence.columnProfiles, 'numeric');
		if (numeric) {
			pushAction(actions, {
				id: `filter:${numeric}`,
				kind: 'add-filter-stage',
				label: `Add pre-filter on ${numeric}`,
				detail: 'Reduce scan and transfer before downstream steps',
				priority: 86,
				payload: { column: numeric }
			});
		}
		pushAction(actions, {
			id: 'take:inspect-100',
			kind: 'add-take-stage',
			label: 'Add inspect limit',
			detail: 'Append take 100 for interactive exploration',
			priority: 82,
			payload: { limit: 100 }
		});
		if (intelligence.columnCount >= 20) {
			const selectedColumns = intelligence.columnProfiles
				.slice(0, 8)
				.map((profile) => profile.name);
			pushAction(actions, {
				id: 'select:trim-wide-shape',
				kind: 'add-select-stage',
				label: 'Trim wide output',
				detail: 'Add a select stage with top columns for faster downstream work',
				priority: 79,
				payload: { columns: selectedColumns.join(',') }
			});
		}
	}

	if (hasPerfWarn || hasLargeResult || input.runImpact.downstreamCount > 1) {
		pushAction(actions, {
			id: 'materialize:cell',
			kind: 'materialize-cell',
			label: 'Materialize this cell',
			detail: 'Cache this boundary for faster downstream reruns',
			priority: 80
		});
	}

	if (input.runImpact.downstreamCount > 0) {
		pushAction(actions, {
			id: 'run:segment',
			kind: 'run-cell-and-downstream',
			label: `Run segment (${input.runImpact.segmentCount} cells)`,
			detail: 'Run this cell and downstream cells in the current segment',
			priority: 78
		});
		pushAction(actions, {
			id: 'schedule:segment',
			kind: 'set-schedule-segment',
			label: 'Schedule by segment',
			detail: 'When scheduled, rerun downstream cells in this segment too',
			priority: 72
		});
	}

	if (input.hasResult) {
		const dateCol = firstColumnByKind(intelligence.columnProfiles, 'date');
		const numericCol = firstColumnByKind(intelligence.columnProfiles, 'numeric');
		if (dateCol && numericCol) {
			pushAction(actions, {
				id: 'chart:line',
				kind: 'open-chart-recommended',
				label: 'Open recommended chart',
				detail: `Line chart using ${dateCol} x ${numericCol}`,
				priority: 70,
				payload: { chartType: 'line', xColumn: dateCol, yColumn: numericCol }
			});
		}
	}

	if (input.isGuiMode && intelligence.joinSuggestions.length > 0) {
		const join = intelligence.joinSuggestions[0];
		if (join) {
			pushAction(actions, {
				id: `join:${join.rightTable}:${join.leftColumn}:${join.rightColumn}`,
				kind: 'insert-join-stage',
				label: `Add join with ${join.rightTable}`,
				detail: `${join.leftColumn} = ${join.rightColumn}`,
				priority: 68,
				payload: {
					rightTable: join.rightTable,
					leftColumn: join.leftColumn,
					rightColumn: join.rightColumn
				}
			});
		}
	}

	if (input.isGuiMode) {
		const dim = firstLikelyDimension(intelligence.columnProfiles);
		const metric = firstColumnByKind(intelligence.columnProfiles, 'numeric');
		if (dim && metric && dim !== metric) {
			pushAction(actions, {
				id: `branch:top:${dim}:${metric}`,
				kind: 'branch-top-contributors',
				label: 'Branch top contributors analysis',
				detail: `Duplicate cell and rank ${dim} by ${metric}`,
				priority: 66,
				payload: { dimension: dim, metric }
			});
		}
	}

	return diversifyRankedActions(actions, input.feedback);
}
