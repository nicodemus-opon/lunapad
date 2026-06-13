import {
	getCells,
	getLastCellId,
	getExternalSchemaTables,
	getTables,
	getLLMConfig,
	getActiveTabId,
	insertCellAfter,
	appendCellAtEnd,
	updateCellCode,
	updateCellMarkdown,
	updateCellName,
	removeCell,
	runCell,
	setCellResultChartConfig,
	setCellResultViewMode,
	setCellMarkdownPreview,
	restoreCellsFromAISnapshot,
	getDashboards,
	type AICellSnapshot
} from '$lib/stores/notebook.svelte.js';
import {
	getMessages,
	appendMessage,
	updateMessageText,
	setMessageStreaming,
	appendActionEvent,
	getIsGenerating,
	setIsGenerating,
	setActiveController,
	getContextCellIds,
	clearContextCells,
	markGhostCell,
	unmarkGhostCell,
	clearGhostCells,
	setPendingSnapshot,
	getPendingSnapshot,
	setUndoAvailable,
	type NotebookSnapshot
} from '$lib/stores/ai-chat.svelte.js';
import type { AIChatRequest, AIChatToolCall, CreateCellArgs, UpdateCellArgs, SetChartArgs, SetViewModeArgs, DeleteCellArgs, RunCellsArgs, GetLineageArgs, FindDashboardUsageArgs, SearchWorkspaceArgs } from '$lib/types/ai-chat.js';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const _sessionId = crypto.randomUUID();

// ── Snapshot ──────────────────────────────────────────────────────────────────

function takeSnapshot(): NotebookSnapshot {
	const notebookId = getActiveTabId();
	const cells = getCells();
	return {
		notebookId,
		cells: cells.map((c) => ({
			id: c.id,
			outputName: c.outputName,
			code: c.code,
			markdown: c.markdown,
			language: c.language,
			cellType: c.cellType,
			display: c.display,
			guiStages: c.guiStages,
			editMode: c.editMode,
			connectionId: c.connectionId
		} satisfies AICellSnapshot))
	};
}

export function undoAIChanges(): void {
	const snap = getPendingSnapshot();
	if (!snap) return;

	// Record outcomes: cells that were created this generation are being deleted
	const ghostIds = new Set([..._outputNameToId.values()]);
	for (const [outputName, cellId] of _outputNameToId) {
		if (ghostIds.has(cellId)) {
			const originalCell = snap.cells.find((c) => c.id === cellId);
			void fetch('/api/ai/outcome', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId: _sessionId,
					cellId,
					outputName,
					outcome: 'deleted',
					originalCode: originalCell?.code ?? ''
				})
			}).catch(() => {});
		}
	}

	clearGhostCells();
	restoreCellsFromAISnapshot(snap.notebookId, snap.cells as AICellSnapshot[]);
	setPendingSnapshot(null);
	setUndoAvailable(false);
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildRequest(contextCellIds: string[], workspaceMemory?: string): AIChatRequest {
	const cells = getCells();
	const schema = getExternalSchemaTables();
	const llmConfig = getLLMConfig();
	const dashboards = getDashboards();

	const conversationMessages = getMessages()
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));

	// Merge DuckDB local tables + external schema tables into unified schema list
	const duckdbTables = getTables().map((t) => ({
		name: t.name,
		columns: t.columns.slice(0, 30)
	}));
	const externalTables = schema.slice(0, 40).map((t) => ({
		name: t.schema ? `${t.schema}.${t.name}` : t.name,
		columns: t.columns.slice(0, 30)
	}));
	const allSchemaTables = [...duckdbTables, ...externalTables].slice(0, 50);

	// Build cellId → dashboard names index (chart blocks reference cells by id)
	const dashboardUsage = new Map<string, string[]>();
	for (const dash of dashboards) {
		for (const block of dash.blocks) {
			if (block.type === 'chart') {
				const arr = dashboardUsage.get(block.cellId) ?? [];
				arr.push(dash.name);
				dashboardUsage.set(block.cellId, arr);
			}
		}
	}

	// Build regex map for whole-word matching of outputNames
	const outputNames = cells.filter((c) => c.outputName).map((c) => c.outputName);
	const nameRegexes = new Map<string, RegExp>(
		outputNames.map((n) => [n, new RegExp(`\\b${escapeRegExp(n)}\\b`)])
	);

	return {
		messages: conversationMessages,
		notebookContext: {
			cells: cells.map((c) => {
				// Upstream: outputNames referenced in this cell's code
				const upstream = outputNames.filter(
					(n) => n !== c.outputName && nameRegexes.get(n)!.test(c.code)
				);
				// Downstream: cells whose code references this cell's outputName
				const downstream = c.outputName
					? outputNames.filter((n) => {
							if (n === c.outputName) return false;
							const dc = cells.find((x) => x.outputName === n);
							return dc ? nameRegexes.get(c.outputName)!.test(dc.code) : false;
					  })
					: [];

				return {
					id: c.id,
					outputName: c.outputName,
					language: c.language,
					code: contextCellIds.includes(c.id) ? c.code : c.code.slice(0, 200),
					resultColumns: c.result?.columns ?? [],
					status: c.status,
					...(upstream.length > 0 && { upstream }),
					...(downstream.length > 0 && { downstream }),
					...(dashboardUsage.has(c.id) && { usedInDashboards: dashboardUsage.get(c.id) })
				};
			}),
			connectionSchema: allSchemaTables,
			activeConnectionId: null
		},
		llmConfig: {
			provider: llmConfig.provider,
			baseUrl: llmConfig.baseUrl,
			model: llmConfig.model
		},
		...(workspaceMemory && { workspaceMemory })
	};
}

// ── Read-only inspection tools ────────────────────────────────────────────────

async function executeReadTool(call: AIChatToolCall, aiMsgId: string): Promise<void> {
	const cells = getCells();
	const dashboards = getDashboards();

	switch (call.tool) {
		case 'get_lineage': {
			const { outputName } = call.args as GetLineageArgs;
			const re = new RegExp(`\\b${escapeRegExp(outputName)}\\b`);

			// Upstream: outputNames referenced in this cell's code
			const target = cells.find((c) => c.outputName === outputName);
			const upstream = target
				? cells
						.filter((c) => c.outputName !== outputName && c.outputName && re.test(target.code) === false)
						.filter((_) => {
							// Find cells whose outputName appears in target's code
							return target ? new RegExp(`\\b${escapeRegExp(_.outputName)}\\b`).test(target.code) : false;
						})
						.map((c) => c.outputName)
				: [];

			// Downstream: cells that reference this outputName
			const downstream = cells
				.filter((c) => c.outputName !== outputName && re.test(c.code))
				.map((c) => c.outputName);

			const dashUsage: string[] = [];
			for (const dash of dashboards) {
				for (const block of dash.blocks) {
					if (block.type === 'chart' && block.cellId === target?.id) {
						dashUsage.push(dash.name);
					}
				}
			}

			const result = target
				? `**Lineage: \`${outputName}\`**\n- Upstream: ${upstream.join(', ') || 'none'}\n- Downstream: ${downstream.join(', ') || 'none'}\n- In dashboards: ${dashUsage.join(', ') || 'none'}`
				: `**Lineage: \`${outputName}\` not found in notebook**`;
			updateMessageText(aiMsgId, `\n\n${result}\n\n`);
			break;
		}

		case 'find_dashboard_usage': {
			const { outputName } = call.args as FindDashboardUsageArgs;
			const target = cells.find((c) => c.outputName === outputName);
			const results: string[] = [];
			if (target) {
				for (const dash of dashboards) {
					const matching = dash.blocks.filter((b) => b.type === 'chart' && b.cellId === target.id);
					if (matching.length) results.push(`${dash.name} (${matching.length} chart${matching.length > 1 ? 's' : ''})`);
				}
			}
			updateMessageText(
				aiMsgId,
				`\n\n**Dashboard usage for \`${outputName}\`:** ${results.join(', ') || 'not used in any dashboard'}\n\n`
			);
			break;
		}

		case 'list_cells': {
			const queryCells = cells.filter((c) => c.cellType === 'query');
			if (queryCells.length === 0) {
				updateMessageText(aiMsgId, '\n\n**Cells:** (none)\n\n');
				break;
			}
			const summary = queryCells
				.map((c) => `- \`${c.outputName}\` (${c.language}, ${c.status}, ${c.result?.rows?.length ?? 0} rows)`)
				.join('\n');
			updateMessageText(aiMsgId, `\n\n**Cells:**\n${summary}\n\n`);
			break;
		}

		case 'search_workspace': {
			const { query } = call.args as SearchWorkspaceArgs;
			try {
				const res = await fetch('/api/ai/search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query })
				});
				if (!res.ok) throw new Error(`search failed: ${res.status}`);
				const data = (await res.json()) as {
					cells: Array<{ output_name: string; code_snippet: string; similarity: number }>;
					tables: Array<{ table_name: string; column_names: string; similarity: number }>;
				};
				const cellLines = data.cells.map((c) => `- \`${c.output_name}\` (${(c.similarity * 100).toFixed(0)}% match)`);
				const tableLines = data.tables.map((t) => `- \`${t.table_name}\`: ${t.column_names}`);
				const text =
					`\n\n**Search: "${query}"**\n` +
					(cellLines.length ? `Relevant cells:\n${cellLines.join('\n')}\n` : '') +
					(tableLines.length ? `Relevant tables:\n${tableLines.join('\n')}\n` : '') +
					(!cellLines.length && !tableLines.length ? 'No matches found.\n' : '');
				updateMessageText(aiMsgId, text + '\n');
			} catch {
				updateMessageText(aiMsgId, `\n\n**Search unavailable** — vector index not set up yet.\n\n`);
			}
			break;
		}
	}
}

// ── Tool call executor ────────────────────────────────────────────────────────

async function executeToolCall(call: AIChatToolCall, aiMsgId: string): Promise<void> {
	// Read-only inspection tools — inject result as text, no notebook mutations
	if (call.tool === 'get_lineage' || call.tool === 'find_dashboard_usage' || call.tool === 'list_cells' || call.tool === 'search_workspace') {
		await executeReadTool(call, aiMsgId);
		return;
	}

	switch (call.tool) {
		case 'create_cell': {
			const args = call.args as CreateCellArgs;
			// Ensure outputName is never null/undefined
			const outputName = args.outputName ?? `ai_cell_${Date.now()}`;
			const cells = getCells();
			const anchor = args.afterCellId ?? (cells.length > 0 ? cells[cells.length - 1].id : '');

			let newCellId: string;
			const isMarkdown = args.cellType === 'markdown' || args.markdown !== undefined;

			if (isMarkdown) {
				newCellId = appendCellAtEnd({
					outputName,
					code: '',
					language: 'sql',
					editMode: 'prql',
					guiStages: [],
					markdown: args.markdown ?? ''
				});
			} else if (anchor) {
				newCellId = insertCellAfter(anchor, {
					outputName,
					code: args.code ?? '',
					language: args.language ?? 'sql',
					editMode: args.editMode ?? 'prql',
					guiStages: []
				});
			} else {
				newCellId = appendCellAtEnd({
					outputName,
					code: args.code ?? '',
					language: args.language ?? 'sql',
					editMode: args.editMode ?? 'prql',
					guiStages: []
				});
			}

			if (newCellId) {
				markGhostCell(newCellId);
				// Put markdown cells directly into preview so they render immediately
				if (isMarkdown) setCellMarkdownPreview(newCellId, true);
				appendActionEvent(aiMsgId, {
					tool: 'create_cell',
					label: `Created ${isMarkdown ? 'markdown' : 'SQL'} cell \`${outputName}\``,
					cellId: newCellId
				});
				// Map outputName AND callId → newCellId for downstream references in this generation
				_outputNameToId.set(outputName, newCellId);
				if (call.callId) _callIdToId.set(call.callId, newCellId);
			}
			break;
		}

		case 'update_cell': {
			const args = call.args as UpdateCellArgs;
			// Resolve cellId: may be an outputName or actual id
			const cellId = resolveCellId(args.cellId);
			if (!cellId) break;

			if (args.code !== undefined) updateCellCode(cellId, args.code);
			if (args.outputName !== undefined) updateCellName(cellId, args.outputName);
			appendActionEvent(aiMsgId, {
				tool: 'update_cell',
				label: `Edited cell \`${args.outputName ?? args.cellId}\``,
				cellId
			});
			break;
		}

		case 'set_chart': {
			const args = call.args as SetChartArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) break;

			setCellResultChartConfig(cellId, args.chartConfig);
			setCellResultViewMode(cellId, 'chart');
			_chartedCellIds.add(cellId);
			appendActionEvent(aiMsgId, {
				tool: 'set_chart',
				label: `Chart configured for \`${args.cellId}\``,
				cellId
			});
			break;
		}

		case 'set_view_mode': {
			const args = call.args as SetViewModeArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) break;
			setCellResultViewMode(cellId, args.mode);
			break;
		}

		case 'delete_cell': {
			const args = call.args as DeleteCellArgs;
			const cellId = resolveCellId(args.cellId);
			if (!cellId) break;
			unmarkGhostCell(cellId);
			removeCell(cellId);
			appendActionEvent(aiMsgId, { tool: 'delete_cell', label: `Deleted cell \`${args.cellId}\`` });
			break;
		}

		case 'run_cells': {
			const args = call.args as RunCellsArgs;
			// cellIds may be undefined/empty — fall back to all ghost cells created this generation
			const rawIds: string[] = args.cellIds?.length
				? args.cellIds
				: [..._outputNameToId.values()];
			const resolvedIds = rawIds.map((id: string) => resolveCellId(id)).filter((id: string | null): id is string => !!id);
			for (const cellId of resolvedIds) {
				_alreadyRanIds.add(cellId);
				void runCell(cellId);
			}
			if (resolvedIds.length > 0) {
				appendActionEvent(aiMsgId, {
					tool: 'run_cells',
					label: `Running ${resolvedIds.length} cell${resolvedIds.length > 1 ? 's' : ''}…`
				});
			}
			break;
		}
	}
}

// Maps outputName → cellId for cells created during the current generation
let _outputNameToId = new Map<string, string>();
// Maps callId → cellId so models can reference newly-created cells by their creation callId
let _callIdToId = new Map<string, string>();
// Track cells explicitly run via run_cells so we don't double-run them
let _alreadyRanIds = new Set<string>();
// Track cells that already have a chart configured this generation
let _chartedCellIds = new Set<string>();

/**
 * Infer a chart config from a SQL SELECT clause.
 * Handles GROUP BY aggregations, ORDER BY + LIMIT (ranked lists), and window functions.
 * Returns null if the query doesn't produce chartable output.
 */
function inferChartFromSQL(sql: string): { chartType: 'bar' | 'line' | 'area' | 'pie'; xColumn: string; yColumns: string[]; colorColumn: null } | null {
	if (!sql) return null;
	const upper = sql.toUpperCase();

	const hasGroupBy = upper.includes('GROUP BY');
	const hasOrderBy = upper.includes('ORDER BY');
	const hasLimit = upper.includes('LIMIT');

	// Only chart queries with GROUP BY, or ranked lists (ORDER BY + LIMIT)
	if (!hasGroupBy && !(hasOrderBy && hasLimit)) return null;

	// Extract SELECT list (between SELECT and FROM)
	const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s/i);
	if (!selectMatch) return null;

	const selectList = selectMatch[1];

	// Split on commas respecting nested parentheses
	const cols: string[] = [];
	let depth = 0, cur = '';
	for (const ch of selectList) {
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		if (ch === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; }
		else cur += ch;
	}
	if (cur.trim()) cols.push(cur.trim());

	const xCols: string[] = [];
	const yCols: string[] = [];

	// Patterns that indicate an aggregate or numeric measure
	const AGG_RE = /^(COUNT|SUM|AVG|MIN|MAX|ROUND|CEIL|FLOOR|COALESCE|NULLIF|CAST|EXTRACT|DATE_TRUNC|STRFTIME|EPOCH|TOTAL)\s*\(/i;
	// Patterns that indicate a date/time column name
	const TIME_RE = /month|week|day|date|year|quarter|period|time|hour|minute|created|updated|ts$/i;

	for (const col of cols) {
		// Extract alias: "SUM(amount) AS total_revenue" → "total_revenue"
		// or bare identifier: "customer_name" → "customer_name"
		const aliasMatch = col.match(/\bAS\s+["']?(\w+)["']?\s*$/i);
		const bareMatch = col.match(/(?:^|[.(])(\w+)\s*$/);
		const name = aliasMatch ? aliasMatch[1] : (bareMatch ? bareMatch[1] : col.trim().replace(/[^a-z0-9_]/gi, '_'));

		if (AGG_RE.test(col)) {
			yCols.push(name);
		} else {
			xCols.push(name);
		}
	}

	if (xCols.length === 0 || yCols.length === 0) return null;

	const xLower = xCols[0].toLowerCase();
	const isTimeSeries = TIME_RE.test(xLower);

	// Use pie for small-cardinality categoricals when there's only one measure and ≤1 dimension
	const isPie = !isTimeSeries && xCols.length === 1 && yCols.length === 1 && hasLimit && !hasGroupBy;

	let chartType: 'bar' | 'line' | 'area' | 'pie';
	if (isPie) {
		chartType = 'pie';
	} else if (isTimeSeries) {
		// Area charts look better for cumulative/trended time series; line for counts/rates
		const isArea = yCols.some((y) => /cumul|total|running|growth|revenue|amount|sales|gmv/i.test(y));
		chartType = isArea ? 'area' : 'line';
	} else {
		chartType = 'bar';
	}

	return { chartType, xColumn: xCols[0], yColumns: yCols, colorColumn: null };
}

function resolveCellId(ref: string): string | null {
	// Try direct id match
	const cells = getCells();
	const byId = cells.find((c) => c.id === ref);
	if (byId) return byId.id;

	// Try outputName match (AI may reference by name)
	const byName = cells.find((c) => c.outputName === ref);
	if (byName) return byName.id;

	// Try outputName map from this generation
	const byOutputName = _outputNameToId.get(ref);
	if (byOutputName) return byOutputName;

	// Try callId map — some models reference a created cell by its creation callId
	return _callIdToId.get(ref) ?? null;
}

// ── Main submit ───────────────────────────────────────────────────────────────

export async function submitAIMessage(userText: string): Promise<void> {
	if (getIsGenerating()) return;

	// Snapshot before any mutations
	setPendingSnapshot(takeSnapshot());
	setUndoAvailable(false);

	const contextCellIds = getContextCellIds();
	clearContextCells();
	_outputNameToId = new Map();
	_callIdToId = new Map();
	_alreadyRanIds = new Set();
	_chartedCellIds = new Set();

	// Append user message to thread
	appendMessage({
		role: 'user',
		text: userText,
		isStreaming: false,
		contextPills: contextCellIds.map((id) => {
			const cell = getCells().find((c) => c.id === id);
			return { cellId: id, cellName: cell?.outputName ?? id };
		}),
		actionEvents: []
	});

	// Start streaming AI message
	const aiMsg = appendMessage({
		role: 'assistant',
		text: '',
		isStreaming: true,
		contextPills: [],
		actionEvents: []
	});

	const abortController = new AbortController();
	setActiveController(abortController);
	setIsGenerating(true);

	try {
		// Fetch workspace patterns for memory-aware prompting (best-effort)
		let workspaceMemory: string | undefined;
		try {
			const memRes = await fetch('/api/ai/patterns');
			if (memRes.ok) {
				const memData = (await memRes.json()) as { patterns?: string };
				workspaceMemory = memData.patterns || undefined;
			}
		} catch { /* skip silently */ }

		const reqBody = buildRequest(contextCellIds, workspaceMemory);
		const response = await fetch('/api/ai/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(reqBody),
			signal: abortController.signal
		});

		if (!response.ok) {
			const errText = await response.text();
			updateMessageText(aiMsg.id, `Error: ${errText.slice(0, 200)}`);
			setMessageStreaming(aiMsg.id, false);
			return;
		}

		const reader = response.body!.getReader();
		const dec = new TextDecoder();

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = dec.decode(value, { stream: true });

			for (const line of chunk.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const data = trimmed.slice(5).trim();

				let event: { type: string; [key: string]: unknown };
				try {
					event = JSON.parse(data) as { type: string; [key: string]: unknown };
				} catch {
					continue;
				}

				switch (event.type) {
					case 'text_delta':
						if (typeof event.delta === 'string') updateMessageText(aiMsg.id, event.delta);
						break;
					case 'tool_call':
						await executeToolCall(event.call as AIChatToolCall, aiMsg.id);
						break;
					case 'plan_delta':
						if (event.plan) {
							const p = event.plan as { tables?: string[]; cells?: string[]; approach?: string };
							const planText =
								`\n\n> **Plan:** ${p.approach ?? ''}\n` +
								(p.tables?.length ? `> Tables: ${p.tables.join(', ')}\n` : '') +
								(p.cells?.length ? `> Creates: ${p.cells.join(', ')}\n` : '') +
								'\n';
							updateMessageText(aiMsg.id, planText);
						}
						break;
					case 'error':
						updateMessageText(aiMsg.id, `\n\n⚠ ${event.error}`);
						break;
					case 'done':
						break;
				}
			}
		}
	} catch (err) {
		if (!(err instanceof Error && err.name === 'AbortError')) {
			updateMessageText(aiMsg.id, `\n\n⚠ ${err instanceof Error ? err.message : 'Unknown error'}`);
		}
	} finally {
		const allCells = getCells();

		// Auto-configure charts for query cells the model didn't chart
		for (const [, cellId] of _outputNameToId) {
			if (_chartedCellIds.has(cellId)) continue;
			const cell = allCells.find((c) => c.id === cellId);
			if (!cell || cell.cellType === 'markdown') continue;
			const chart = inferChartFromSQL(cell.code);
			if (chart) {
				setCellResultChartConfig(cellId, chart);
				setCellResultViewMode(cellId, 'chart');
			}
		}

		// Auto-run any query cells created this generation that the model forgot to run
		for (const [, cellId] of _outputNameToId) {
			if (_alreadyRanIds.has(cellId)) continue;
			const cell = allCells.find((c) => c.id === cellId);
			if (cell && cell.cellType !== 'markdown') {
				void runCell(cellId);
			}
		}
		// Trigger background embedding for newly created/updated cells
		const notebookId = getActiveTabId();
		const cellsToEmbed = [..._outputNameToId.entries()]
			.map(([outputName, cellId]) => {
				const cell = allCells.find((c) => c.id === cellId);
				return cell && cell.cellType !== 'markdown' ? { notebookId, cellId, outputName, code: cell.code } : null;
			})
			.filter((x): x is { notebookId: string; cellId: string; outputName: string; code: string } => x !== null);
		if (cellsToEmbed.length > 0) {
			void fetch('/api/ai/embed', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(cellsToEmbed[0])
			}).catch(() => {});
		}

		clearGhostCells();
		setMessageStreaming(aiMsg.id, false);
		setIsGenerating(false);
		setActiveController(null);
		setUndoAvailable(true);
	}
}
