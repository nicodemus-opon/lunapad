import type { RequestHandler } from './$types';
import type {
	AIChatRequest,
	AIChatToolCall,
	AIChatToolName,
	AIChatCell,
	AIChatSchemaTable,
	WorkspaceContract
} from '$lib/types/ai-chat.js';
import { parseToolCallObject } from '$lib/services/tool-call-parse.js';
import { buildMarkdocSyntaxBlock } from '$lib/services/markdoc-prompt.js';
import { repairMarkdocTagBalance } from '$lib/services/markdoc-interp.js';
import { buildGeneratedDashboardPromptBlock } from '$lib/services/generated-dashboard.js';
import {
	compileStructuredMarkdownArgs,
	hasDashboardResultContextFromMessages
} from './structured-markdown.js';
import { READONLY_INVESTIGATION_TOOLS } from '$lib/server/ai-tools.js';
import { selectSchemaForPrompt, resolveExternalSchema } from '$lib/server/ai-schema-context.js';
import {
	DEFAULT_SCHEMA_TOKEN_BUDGET,
	SMALL_MODEL_SCHEMA_TOKEN_BUDGET
} from '$lib/services/token-budget.js';
import { NATIVE_TOOLS } from '$lib/agent/server/tools/native-schemas.js';
import { schemasForChat } from '$lib/agent/tools/registry.js';
import {
	send,
	flushDoneBlocks,
	flushBareSuggestionsJson,
	flushPlanProposalBlocks,
	flushSprintBlocks,
	flushSprintUpdateBlocks,
	flushPlanBlocks,
	flushToolCalls,
	extractRawJsonToolCalls,
	stripBarePlanJson,
	stripThinkBlocks,
	stripOpenTag,
	normalizeToolCallArgs,
	type SSEController
} from '$lib/agent/server/stream/sse-helpers.js';
import { STOP_AFTER_TOOLS } from '$lib/agent/server/stream/stop-after.js';
import {
	isChatToolCallAllowed,
	blockedToolFallbackText,
	type ChatToolPolicyContext
} from '$lib/agent/server/chat-tool-policy.js';
import { buildUserContent } from '$lib/server/ai-user-content.js';
import { normalizeSafeLlmBaseUrl } from '$lib/server/safe-outbound-url';

function isMeaningfulTextDelta(delta: string): boolean {
	return delta.replace(/[\s;.,:`'"_\-]+/g, '').length >= 2;
}

function sendTextDelta(ctrl: SSEController, delta: string, onMeaningful?: () => void): void {
	if (!isMeaningfulTextDelta(delta)) return;
	send(ctrl, { type: 'text_delta', delta });
	onMeaningful?.();
}

function parseJsonishToolValue(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed || !/^[{[]/.test(trimmed)) return value;
	const parsed = parseToolCallObject(trimmed);
	if (parsed) return parsed;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function normalizeNotebookToolArgs(args: Record<string, unknown>): Record<string, unknown> {
	const next = { ...args };
	if ('blueprint' in next) next.blueprint = parseJsonishToolValue(next.blueprint);
	if (next.blueprint && typeof next.blueprint === 'object' && !Array.isArray(next.blueprint)) {
		const blueprint = { ...(next.blueprint as Record<string, unknown>) };
		for (const key of ['blocks', 'executableCells']) {
			if (key in blueprint) blueprint[key] = parseJsonishToolValue(blueprint[key]);
		}
		next.blueprint = blueprint;
	}
	for (const key of ['blocks', 'executableCells', 'operations', 'document']) {
		if (key in next) next[key] = parseJsonishToolValue(next[key]);
	}
	return next;
}

function formatCellGraph(c: AIChatCell): string {
	const lang = c.cellType === 'python' ? 'python' : c.language;
	const attached = c.isContextCell ? '[ATTACHED] ' : '';
	const parts: string[] = [`${attached}${c.outputName}(${lang},${c.status})`];
	if (c.cellType === 'markdown') {
		const markdownHint = (c.markdown ?? c.code).replace(/\s+/g, ' ').trim().slice(0, 120);
		if (markdownHint) parts.push(`[markdown: ${markdownHint}]`);
	}
	if (c.upstream?.length) parts.push(`←[${c.upstream.join(',')}]`);
	if (c.downstream?.length) parts.push(`→[${c.downstream.join(',')}]`);
	if (c.criticalityScore && c.criticalityScore >= 3) {
		parts.push(`[HIGH IMPACT — ${c.criticalityScore} dependents]`);
	}
	if (c.errorMessage) parts.push(`[ERROR: ${c.errorMessage}]`);
	if (c.pythonError) parts.push(`[ERROR: ${c.pythonError}]`);
	return parts.join(' ');
}

/**
 * Compact, directive prompt for local Ollama models (qwen3, gemma, mistral).
 * Uses explicit <tool_call> tag syntax — smaller models follow explicit templates
 * far more reliably than open-ended native function calling.
 */
function isSmallModel(model: string): boolean {
	// Match standard sizes like :7b, :8b, :1.5b
	// Also match quantization-prefixed sizes like :e4b (gemma4:e4b = 8B/Q4), :q4b, :w4b
	const m = model.match(/(?:^|[:/_-])[a-z]*(\d+(?:\.\d+)?)b(?:$|[:/_-])/i);
	return m !== null && parseFloat(m[1]) <= 8;
}

function extractTableRefs(code: string): Set<string> {
	const refs = new Set<string>();
	for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+([\w."]+)/gi)) {
		refs.add(m[1].replace(/"/g, '').toLowerCase());
	}
	return refs;
}

function activeTableNamesFromCells(cells: AIChatCell[]): Set<string> {
	const activeTables = new Set<string>();
	for (const c of cells) {
		for (const ref of extractTableRefs(c.code)) activeTables.add(ref);
	}
	return activeTables;
}

function buildDialectSection(dialect: string): string {
	if (dialect === 'trino') {
		return `\n\n## SQL Dialect: Trino
- Random sample: ORDER BY rand() LIMIT n  (no USING SAMPLE)
- Dates: DATE_TRUNC('month', col), DATE_ADD('day', n, col), DATE_DIFF('day', a, b)
- Approx: approx_distinct(col), approx_percentile(col, 0.95)
- Arrays: CROSS JOIN UNNEST(arr) AS t(val), array_agg(), array_join(arr, ',')
- Strings: split(col, ','), regexp_extract(col, pattern, group)
- Text stored as VARCHAR: CAST(col AS TIMESTAMP/DATE/DOUBLE) or date_parse(col, format) before comparing to dates/numbers.
- JSON/VARIANT columns (often VARCHAR): json_parse(col) then json_extract_scalar(col, '$.key') — not native -> operators.
- VARBINARY: from_utf8(col) for text — never CAST(col AS VARCHAR). Lunapad maps binary types at catalog level; re-save source if still VARBINARY.
- MySQL TIMESTAMP is TIMESTAMP WITH TIME ZONE in Trino — watch timezone when comparing to current_date.
- No DuckDB syntax: no LIST_AGG, no STRUCT, no generate_series, no EXCLUDE/REPLACE
- Table references use the full name shown in the Schema section (catalog.schema.table)
- Identifiers: use double-quotes for reserved words or names with spaces: "my column". NEVER use backticks — they are MySQL syntax and are a syntax error in Trino.
- Column reference: write t."My Column" NOT t["My Column"] — bracket subscript is array access, not column access.`;
	}
	return `\n\n## SQL Dialect: DuckDB
- Random sample: SELECT * FROM t USING SAMPLE n ROWS
- Arrays: LIST_AGG(col, ','), ARRAY_AGG(col), list_sort(), unnest()
- Structs: {key: val}, struct_pack()
- Dates: col + INTERVAL '7 days', strftime(col, '%Y-%m'), date_trunc('month', col), strptime(str_col, '%B %d, %Y')::DATE (parse string→date; try_strptime for nullable)
- Strings: string_split(col, ','), regexp_extract(col, pattern), str_split_regex()
- Extras: generate_series(), range(), SELECT * EXCLUDE (col), SELECT * REPLACE (expr AS col)
- Identifiers: use double-quotes for reserved words or names with spaces: "my column". NEVER use backticks — they are MySQL syntax and are a syntax error in DuckDB.
- Column reference: write t."My Column" NOT t["My Column"] — bracket subscript is array access, not column access.`;
}

function buildSystemPromptOllama(
	cells: AIChatCell[],
	schema: AIChatSchemaTable[],
	workspaceMemory?: string,
	sessionDataContext?: Record<string, string>,
	nativeTools = false,
	workspaceContract?: WorkspaceContract,
	sessionPlanContext?: string[],
	schemaChangeNote?: string,
	connectionDialect = 'duckdb',
	isSmall = false,
	pythonAvailable = false
): string {
	const cellList = cells.length > 0 ? cells.map(formatCellGraph).join(', ') : 'none';

	// `schema` arrives already selected/token-budgeted by `selectSchemaForPrompt` (called once,
	// in POST, before branching into whichever prompt builder is needed) — no further
	// truncation here.
	const prioritizedSchema = schema;
	const schemaList =
		prioritizedSchema.length > 0
			? prioritizedSchema
					.map((t) => {
						const cols = t.columns
							.map((col, i) => {
								const raw = t.columnTypes?.[i] ?? '';
								const type = raw.match(/INT|FLOAT|DOUBLE|DECIMAL|NUMERIC|REAL/i)
									? 'NUM'
									: raw.match(/DATE|TIME/i)
										? 'DATE'
										: raw.match(/BOOL/i)
											? 'BOOL'
											: raw
												? 'TEXT'
												: '';
								const quotedCol = col.includes(' ') ? `"${col}"` : col;
								return type ? `${quotedCol}:${type}` : quotedCol;
							})
							.join(', ');
						const rowNote = t.rowCount != null ? ` [${t.rowCount.toLocaleString()} rows]` : '';
						// Skip column profiles for small models to save tokens
						const profiles =
							!isSmall && t.columnProfiles
								? Object.entries(t.columnProfiles)
										.map(([col, summary]) => `    ${col}: ${summary}`)
										.join('\n')
								: '';
						return `${t.name}(${cols})${rowNote}${profiles ? '\n' + profiles : ''}`;
					})
					.join('\n  ')
			: 'none — ask the user to upload data first';

	const memNote = workspaceMemory ? `\nWorkspace history: ${workspaceMemory}` : '';
	const dataNote =
		sessionDataContext && Object.keys(sessionDataContext).length > 0
			? '\n\nData already investigated this session:\n' +
				Object.entries(sessionDataContext)
					.map(([k, v]) => `- ${k}: ${v}`)
					.join('\n')
			: '';
	const planNote =
		sessionPlanContext && sessionPlanContext.length > 0
			? '\n\nEstablished decisions (do not re-investigate):\n' +
				sessionPlanContext.map((d, i) => `${i + 1}. ${d}`).join('\n')
			: '';
	const schemaChangeNote2 = schemaChangeNote ? `\n\n⚠ ${schemaChangeNote}` : '';
	const contractNote = buildWorkspaceContractSection(workspaceContract);

	const formatSection = nativeTools
		? ''
		: `
TOOL CALL FORMAT — args always nested under "args":
Complete notebook: <tool_call>{"tool":"create_notebook","callId":"N1","args":{"blueprint":{"title":"Revenue Review","executableCells":[{"cellId":"q_monthly_revenue","outputName":"monthly_revenue","cellType":"query","language":"sql","code":"SELECT ..."}],"blocks":[{"type":"text","content":"# Revenue Review"},{"type":"queryBlock","cellId":"q_monthly_revenue"},{"type":"grid","cols":2,"items":[{"type":"metric","value":"$monthly_revenue.revenue","label":"Revenue"}]}]}}}</tool_call>
Inspect notebook: <tool_call>{"tool":"inspect_notebook","callId":"I1","args":{}}</tool_call>
Patch notebook:   <tool_call>{"tool":"apply_notebook_patch","callId":"P1","args":{"operations":[{"op":"patch_attrs","nodeId":"NODE_ID","attrs":{"tagName":"card"}}]}}</tool_call>
Run query nodes:  <tool_call>{"tool":"run_query_nodes","callId":"R1","args":{"cellIds":["q_monthly_revenue"]}}</tool_call>
Validate notebook:<tool_call>{"tool":"validate_notebook","callId":"V1","args":{}}</tool_call>
Auto chart:      <tool_call>{"tool":"pick_chart","callId":"C5","args":{"cellId":"C1"}}</tool_call>
Custom chart:    <tool_call>{"tool":"set_chart","callId":"C6","args":{"cellId":"C1","chartConfig":{"chartType":"area","xColumn":"month","yColumns":["revenue"],"title":"Revenue Over Time"}}}</tool_call>
Query data:      <tool_call>{"tool":"query_data","callId":"D1","args":{"sql":"SELECT DISTINCT status FROM orders LIMIT 10"}}</tool_call>
Sample table:    <tool_call>{"tool":"sample_data","callId":"D2","args":{"table":"orders","n":5}}</tool_call>
Profile col:     <tool_call>{"tool":"profile_column","callId":"D3","args":{"table":"orders","column":"status"}}</tool_call>
Get cell result: <tool_call>{"tool":"get_cell_result","callId":"D4","args":{"cellId":"C1","limit":20}}</tool_call>
List cells:      <tool_call>{"tool":"list_cells","callId":"L1","args":{}}</tool_call>
Search:          <tool_call>{"tool":"search_workspace","callId":"S1","args":{"query":"customer dim"}}</tool_call>
Record decision: <tool_call>{"tool":"record_decision","callId":"R1","args":{"decision":"treating email as FK to customers — no id in source"}}</tool_call>
Ask user:        <tool_call>{"tool":"ask_user","callId":"Q1","args":{"question":"Which join key — customer_id or email?","options":["customer_id","email"]}}</tool_call>
`;

	// Small models (≤8B): compact prompt — one-shot format example first, 6 critical rules, trimmed context
	if (isSmall) {
		const smallPlanNote =
			sessionPlanContext && sessionPlanContext.length > 0
				? '\nDecisions: ' + sessionPlanContext.slice(-3).join('; ')
				: '';
		return `TOOL FORMAT — use exactly:
<tool_call>{"tool":"create_notebook","callId":"N1","args":{"blueprint":{"title":"Sales Review","executableCells":[{"cellId":"q_sales_by_month","outputName":"sales_by_month","cellType":"query","language":"sql","code":"SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 1"}],"blocks":[{"type":"text","content":"# Sales Review"},{"type":"queryBlock","cellId":"q_sales_by_month"}]}}}</tool_call>
<tool_call>{"tool":"run_query_nodes","callId":"R1","args":{"cellIds":["q_sales_by_month"]}}</tool_call>
<tool_call>{"tool":"validate_notebook","callId":"V1","args":{}}</tool_call>
<tool_call>{"tool":"sample_data","callId":"D1","args":{"table":"orders","n":5}}</tool_call>
<tool_call>{"tool":"query_data","callId":"D2","args":{"sql":"SELECT DISTINCT status FROM orders LIMIT 5"}}</tool_call>

You are an analytics engineer building SQL notebooks.

RULES:
1. ONLY use column names listed in Schema — never invent names.
2. NEVER write WITH (...) CTEs — write SELECT FROM tablename directly.
3. NEVER end SQL with semicolon (;).
4. ALL SQL goes inside tool_call args — never in prose.
5. After run_query_nodes: if a query failed, repair with apply_notebook_patch then run_query_nodes again.
6. End with <done>{"suggestions":["short 1","short 2","short 3"]}</done> only after validate_notebook returns ok:true.

Other tools: inspect_notebook{}, apply_notebook_patch{blueprint|document|operations}, list_cells{}, search_workspace{query}
${contractNote}${buildDialectSection(connectionDialect)}${pythonAvailable ? '' : '\nNo Python cells available — SQL only.'}

Cells: ${cellList}
Schema:
  ${schemaList}${schemaChangeNote2}${smallPlanNote}`;
	}

	// Larger Ollama models: full prompt with format examples moved to front for stronger attention
	return `${formatSection}
You are a senior analytics engineer responsible for designing maintainable, reusable analytical data models. Build professional notebooks using tool calls.

RULES:
0. COMPLETE NOTEBOOKS: create and edit notebooks with create_notebook / inspect_notebook / apply_notebook_patch / run_query_nodes / validate_notebook. Do not use legacy cell-by-cell authoring.
1. DISCOVER FIRST (for new models): Call list_cells and search_workspace before creating new query payloads. State what you found. DUPLICATION IS A MODELING ERROR — check before you build.
2. INVESTIGATE DATA: Call sample_data on unfamiliar tables before writing SQL. Skip if session data context already shows the table.
3. SCHEMA IS LAW: ONLY use column names listed in the Schema section. Column names shown as "name" (with double-quotes) contain spaces — you MUST write them as "name" in SQL.
4. NOTEBOOK STRUCTURE: narrative and rich UI belong in the blueprint/PM document blocks, not raw markdown cells.
5. NEVER end SQL with a semicolon (;). Trailing semicolons break CTE chaining.
6. NEVER write WITH clauses — each cell's outputName is auto-wrapped as a CTE.
7. MATERIALIZATION: set materializeMode on new model cells (table/view/incremental/ephemeral) per workspace conventions.
8. CHARTS — configure charts through queryBlock presentation or pick_chart/set_chart only after query nodes run clean.
9. NEVER write SQL in prose or markdown code blocks. ALL SQL goes inside tool_call args.
10. Modify existing notebooks with inspect_notebook then apply_notebook_patch. Call run_query_nodes after query payload changes.
11. Use window functions (LAG, RANK, SUM OVER, ROW_NUMBER) for growth rates, rankings, running totals.
12. Build a complete notebook blueprint, run_query_nodes, validate_notebook, then finish.
13. SELF-CORRECT: After run_query_nodes, if ANY query failed, repair with apply_notebook_patch and retry. Do NOT output <done> until all succeed.
14. DONE: <done>{"suggestions":["short follow-up 1","short follow-up 2","short follow-up 3"]}</done>. Keep each suggestion under 60 chars. Completion requires validate_notebook ok:true.
15. MODELING LAYERS: stg_ = staging — REQUIRED: cast types, coalesce NULLs, deduplicate, AND extract features (date parts like day_of_week/month/quarter, text splits like email_domain, CASE tier buckets like price_tier/churn_risk) so fct_/mart_ never re-derive them. dim_ = entity tables (one row per entity). fct_ = fact events (one row per event, must have timestamp + FK to dims). mart_ = reporting (SELECT only from fct_/dim_, no raw tables). State grain (1 row = 1 what?) before writing any cell.
16. DOCUMENT YOUR WORK: include findings, data quality notes, and key decisions as narrative blocks in the PM document.
17. LIVE REFS IN MARKDOWN: ${buildMarkdocSyntaxBlock()}
18. STRUCTURED NOTEBOOK UI: ${buildGeneratedDashboardPromptBlock()}
19. RECORD DECISIONS & DISCOVERIES: after confirming a primary key, join key, grain, or business rule, call record_decision (type: "decision"). Also call it for a notable data fact — unexpected null rate, surprising cardinality, a gotcha (type: "discovery"). Persisted to disk, not just this conversation — re-injected in future turns and retrievable later via search_workspace, so you and future sessions never re-investigate it.
20. ASK ONLY WHEN GENUINELY BLOCKED: call ask_user only when an ambiguity cannot be resolved by investigating data (sample_data/query_data/profile_column) and a wrong guess would mean redoing significant work (e.g. two equally plausible join keys, or unclear whether to reuse an existing cell vs create a new one). Prefer a stated default over asking — pick the more common convention, note the assumption, and proceed. Never ask about anything answerable from the Schema or Cells sections above. Provide options only for a naturally short discrete choice (2-4 items); omit options otherwise. At most once per task unless the answer creates a new ambiguity.

You MAY write 1–2 sentences of explanation before tool calls.

Notebook cells: ${cellList}
Schema:
  ${schemaList}${memNote}${dataNote}${planNote}${schemaChangeNote2}${contractNote}${buildDialectSection(connectionDialect)}${buildToolSelectionSection(pythonAvailable)}`;
}

function buildToolSelectionSection(pythonAvailable: boolean): string {
	if (pythonAvailable) {
		return `\n\n## Tool selection\nUse SQL for relational transforms (joins, filters, aggregations, window functions). Use Python query payloads inside create_notebook/apply_notebook_patch for statistics, ML, text/regex processing, or custom visualization beyond what set_chart/pick_chart support. When a different cell type would serve the request better than an existing query node, add a new queryBlock and executable payload rather than forcing a mismatched language into the old node.

## Python cell data contract (READ before writing any python cell)
Data is INJECTED, never loaded manually. Do NOT read files, open DuckDB/SQL connections, call APIs, or fabricate data.
- Upstream cells are bound as pandas DataFrames by outputName, capped at 1000 rows (same cap the UI uses for query previews) — not the full result set. Workspace tables are exposed through a LAZY \`tables\` namespace, resolved per-run against only the tables your code actually references (the engine never hydrates the full external catalog into the process) — use \`tables.available()\` to list the tables already in scope for this run, or \`tables.find("keyword")\` to search that same bounded set by substring before guessing a name; both are read-only discovery calls, not a warehouse-wide search. To read a table's data: \`tables["schema.table"]\` / \`tables["catalog.schema.table"]\` return a 1000-row preview; \`tables.load("catalog.schema.table")\` instead fetches the ENTIRE table in paginated batches — only use \`.load()\` when you genuinely need full-table row-level computation (e.g. an exact percentile or dedup that can't be pushed to SQL), never as a default, since it can be slow on large tables and a SQL cell computing the aggregate is almost always cheaper. Names passed to \`tables[...]\`/\`tables.load(...)\` must be literal string constants in the code (\`tables["orders"]\`, not a name built from a variable) — that's what makes the targeted, non-hydrating resolution possible; a dynamically-built name won't be seen and will raise \`KeyError\` at runtime. Small local (DuckDB) tables are also bound as a bare global by their exact table name when that name is a valid Python identifier and appears literally in the code — this bare-name binding never applies to external/warehouse tables. pandas (\`pd\`), numpy (\`np\`), and plotly (\`go\`/\`px\`, i.e. \`plotly.graph_objects\`/\`plotly.express\`) are pre-imported; matplotlib is NOT installed or captured — use Plotly (\`go.Figure\`/\`px.*\`) for all chart output from Python.
- The cell's RESULT is the last DataFrame you leave as the final expression (or the last DataFrame assigned). It is always registered into the local DuckDB catalog under this cell's outputName — that's a preview/cache path only, for the UI and for other cells to read from immediately. Separately, when the notebook has a non-DuckDB external connection configured, a successful Python result is ALSO published (uploaded) to that external connection under the same outputName — that external copy, not the local DuckDB cache, is what downstream SQL/PRQL cells on that connection and schedules actually query.
- print(...) goes to stdout; Plotly figures (\`go.Figure\` objects, including anything returned by \`px.*\`) are captured automatically — do not call \`.show()\`. For a tabular result, end the cell with a DataFrame expression.
- Reference an upstream cell by outputName to create a dependency, exactly like a SQL cell would. Never reference a raw uploaded-file table name with a timestamp — go through the cell that reads it.`;
	}
	return `\n\n## Tool selection\nPython cells are not available in this environment — always use SQL, even for tasks that would normally suit Python (statistics, ML, text processing).`;
}

function buildWorkspaceContractSection(contract: WorkspaceContract | undefined): string {
	if (!contract) return '';
	const parts: string[] = [];

	if (contract.namingRules.length > 0) {
		const rows = contract.namingRules
			.map((r) => `  ${r.prefix.padEnd(10)} → ${r.description.padEnd(22)} → ${r.materialization}`)
			.join('\n');
		parts.push(`Naming conventions:\n${rows}`);
	}

	if (contract.topReusableModels.length > 0) {
		const rows = contract.topReusableModels
			.map((m) => `  ${m.name}  — ${m.downstreamCount} downstream`)
			.join('\n');
		parts.push(`Top reusable models:\n${rows}`);
	}

	if (contract.customInstructions?.trim()) {
		parts.push(`Custom instructions:\n${contract.customInstructions.trim()}`);
	}

	if (parts.length === 0) return '';
	return `\n\n## Workspace Contract\n${parts.join('\n\n')}`;
}

function buildSystemPromptXML(
	cells: AIChatCell[],
	schema: AIChatSchemaTable[],
	workspaceMemory?: string,
	sessionDataContext?: Record<string, string>,
	workspaceContract?: WorkspaceContract,
	sessionPlanContext?: string[],
	schemaChangeNote?: string,
	connectionDialect = 'duckdb',
	useNativeTools = false,
	pythonAvailable = false
): string {
	const cellList =
		cells.length > 0
			? cells
					.map((c) => {
						const up = c.upstream?.length ? ` depends_on=[${c.upstream.join(', ')}]` : '';
						const down = c.downstream?.length ? ` feeds_into=[${c.downstream.join(', ')}]` : '';
						const chart = c.resultChartConfig
							? ` chart=${c.resultChartConfig.chartType}(x=${c.resultChartConfig.xColumn},y=[${c.resultChartConfig.yColumns?.join(',')}])`
							: '';
						const active = c.isActiveNotebook ? ' [active]' : '';
						const attached = c.isContextCell ? ' [ATTACHED]' : '';
						const impact =
							(c.criticalityScore ?? 0) >= 3
								? ` [HIGH IMPACT — ${c.criticalityScore} dependents]`
								: '';
						const lang = c.cellType === 'python' ? ' lang=python' : '';
						const err = c.errorMessage
							? ` [ERROR: ${c.errorMessage}]`
							: c.pythonError
								? ` [ERROR: ${c.pythonError}]`
								: '';
						return `  id=${c.id} name="${c.outputName}" status=${c.status}${lang}${active}${attached}${impact}${up}${down}${chart}${err}`;
					})
					.join('\n')
			: '  (none)';

	// `schema` arrives already selected/token-budgeted by `selectSchemaForPrompt` — no further
	// positional truncation here.
	const schemaList =
		schema.length > 0
			? schema
					.map((t) => {
						const colList = t.columns
							.map((col) => (col.includes(' ') ? `"${col}"` : col))
							.join(', ');
						const rowNote = t.rowCount != null ? ` [${t.rowCount.toLocaleString()} rows]` : '';
						const profiles = t.columnProfiles
							? '\n' +
								Object.entries(t.columnProfiles)
									.map(([col, summary]) => `    ${col}: ${summary}`)
									.join('\n')
							: '';
						return `  ${t.name}: ${colList}${rowNote}${profiles}`;
					})
					.join('\n')
			: '  (none)';

	const memSection = workspaceMemory ? `\nWorkspace history: ${workspaceMemory}` : '';
	const dataSection =
		sessionDataContext && Object.keys(sessionDataContext).length > 0
			? '\n\n## Data already investigated this session\n' +
				Object.entries(sessionDataContext)
					.map(([k, v]) => `- ${k}: ${v}`)
					.join('\n')
			: '';
	// #3 — Decisions/discoveries recorded via record_decision (this session, plus the most
	// recent ones persisted to disk from prior sessions when a project folder is open)
	const planSection =
		sessionPlanContext && sessionPlanContext.length > 0
			? '\n\n## Established decisions & discoveries (do not re-investigate)\n' +
				sessionPlanContext.map((d, i) => `${i + 1}. ${d}`).join('\n')
			: '';
	// #9 — Schema-change warning
	const schemaChangeSection = schemaChangeNote ? `\n\n⚠ ${schemaChangeNote}` : '';
	const contractSection = buildWorkspaceContractSection(workspaceContract);

	const toolFmtSection = useNativeTools
		? ''
		: `
Emit tool calls inline in your response using this exact format:
<tool_call>{"tool":"TOOL_NAME","callId":"C1","args":{...}}</tool_call>

IMPORTANT: callId is how you reference tool results later. For notebook query nodes, use the cellId values you placed in create_notebook/apply_notebook_patch executableCells and queryBlock blocks.
`;

	return `You are a senior analytics engineer in Lunapad. Before writing any SQL, identify the **business question** behind the request — not just the technical task. Build what was asked AND the obvious next level: if asked for revenue, also design the customer grain; if the data is sessions, also think about the conversion funnel. Your primary obligation is to the long-term health of the model graph. Your output must read like a real analyst's deliverable — structured, insight-driven, reusable.
${toolFmtSection}

## Modeling Workflow (required when creating any new model)

**Step 0 — Investigate source data** (if working with raw tables you haven't seen)
Call \`sample_data\` to learn actual values, date formats, and nulls before writing SQL.

**Step 1 — Discover** (mandatory before any notebook mutation)
Call \`list_cells\` to survey the full model landscape.
Call \`search_workspace("{intent}")\` to find similar or related models — it returns full SQL for matched cells.
State explicitly what you found before proceeding:
  > "Found reusable: \`dim_customer\`, \`fct_orders\` — will build on these."
  > "Found nothing relevant — creating from scratch."
⚠ **DUPLICATION IS A MODELING ERROR**: creating a cell whose logic duplicates an existing model (rather than extending it) is an error, not a style preference. Always check before you build.

**Step 2 — Plan** (emit before any \`create_notebook\` or \`apply_notebook_patch\` calls)
<plan>
Grain: one row = one [entity/event/metric period]
Reusing: [existing cell names, or "none found"]
Creating: [new_model_name] as [stg_/dim_/fct_/metric_]
Materialization: [table|view|incremental|ephemeral] — [reasoning]
Dependencies: [new_model] ← [upstream cells]
</plan>

**Step 3 — Build** (one atomic notebook operation)
Default to editing the active notebook: call \`inspect_notebook\` then \`apply_notebook_patch\`.
Use \`create_notebook\` only when the user explicitly asks for a new notebook/report/dashboard from scratch, or when the current notebook is empty and the request is clearly to create a standalone deliverable.
Put SQL/Python only in \`executableCells\`, and place each executable in the document with a matching \`queryBlock\`.
Reference existing cells by outputName — they auto-wrap as CTEs. Set \`materializeMode\` per workspace conventions when provided.

**Step 4 — Validate**: call \`run_query_nodes\` for every queryBlock you added or changed, self-correct any errors with \`apply_notebook_patch\`, then call \`validate_notebook\`.

**Step 5 — Document** (required after cells run clean)
Include text blocks leading with **findings** — what the data actually reveals, not just what was built. Format: "**Finding**: 23% of orders have null customer_id — likely guest checkout." Then cover: grain of each model, key decisions (layer, materialization, join logic, dedup), data quality observations (NULLs, duplicates, unexpected values, date range). An analyst reading this notebook should immediately understand what the data *means*, not just what was built.

${buildMarkdocSyntaxBlock()}

${buildGeneratedDashboardPromptBlock()}

**Step 6 — Done**: output the \`<done>\` signal.

## CTE rules (CRITICAL)
1. NEVER write WITH clauses. Each cell's outputName is auto-wrapped as a CTE. Write \`FROM orders\` not \`WITH orders AS (...)\`.
2. DEPENDENCY ORDER: if cell B reads FROM cell A, create cell A FIRST in your tool call sequence.
3. Verify dependencies exist in the Notebook list; if not, create them first.

## SQL quality
- NEVER end SQL with a semicolon (;) — trailing semicolons break CTE chaining
- SQL comments use \`-- like this\`, NEVER \`# like this\` — a leading \`#\` is a parser syntax error in both DuckDB and Trino
- Use meaningful column aliases (revenue, order_count, avg_value — not col1, val)
- Prefer explicit column lists over SELECT *
- Include ORDER BY for ranked/time-series results
- Cast dates/timestamps when grouping by period
- Column names containing spaces must be double-quoted: \`"my column"\` not \`my column\` — columns shown in the Schema section as \`"name"\` require quoting

## Modeling principles
- **Grain first**: State what one row represents in each model (e.g. "one row = one order line")
- **Staging layer** (\`stg_\`): Required steps — (1) cast types and standardize formats, (2) coalesce NULLs to sensible defaults, (3) deduplicate if source has duplicates. **Feature extraction minimum: every stg_ model must derive at least 3 analytical columns** beyond raw source pass-through — a stg_ that only renames and casts is incomplete. Match by column type: timestamps → \`day_of_week\`, \`hour_of_day\`, \`is_weekend\`, \`days_since_event\`; user records → \`account_age_days\`, \`age_bucket\` (CASE), \`is_new_user\` (days_since_signup < 30); monetary → \`value_tier\` (CASE WHEN amount < 50 THEN 'low' …); events → \`time_to_next_event\`, \`session_sequence\`. Text parsing: \`email_domain\` via SPLIT_PART, \`country_code\` from phone prefix. Extracting here means fct_/mart_ cells never re-derive the same logic. **Never apply business filters in stg_.**
- **Deduplication**: \`ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) = 1\` when source has duplicates.
- **Naming layers**: \`stg_\` = staging, \`dim_\` = entity (customers, products), \`fct_\` = fact events (orders, sessions), \`mart_\` = reporting, \`metric_\` = business metrics
- **Reuse over duplication**: prefer a shared \`dim_customers\` cell over repeating JOIN logic everywhere.

## Response format
- Use markdown in your prose: **bold** key findings, bullet lists for multiple points, \`code\` for cell/table names
- Keep explanations tight — the notebook cells speak for themselves

## Tools (action)
- inspect_notebook: {notebookId?:string} — inspect the active notebook document before patching it
- create_notebook: {blueprint:{title:string, executableCells:[{cellId:string, outputName:string, cellType:"query"${pythonAvailable ? '|"python"' : ''}, language:"sql"${pythonAvailable ? '|"python"' : ''}, code:string, materializeMode?:"ephemeral"|"view"|"table"|"incremental"}], blocks:[...]}}
  - Use snake_case cellIds/outputNames describing the query: revenue_by_month, top_customers, order_funnel${pythonAvailable ? '\n  - For Python cells (cellType:"python") write Python source directly in code. See Tool selection below for when to use Python over SQL.' : ''}
  - Include text blocks for intro, methodology, findings, and caveats. SQL belongs exclusively in executableCells, never prose.
- apply_notebook_patch: {title?:string, blueprint:{...}} or {title?:string, document:{...}} or {title?:string, operations:[...], executableCells?:[...]} — patch the active notebook atomically. Use title to rename it.
- run_query_nodes: {cellIds:string[]} or {nodeIds:string[]} — always run all added/changed queryBlock nodes
- validate_notebook: {notebookId?:string} — validate before done
- **pick_chart: {cellId:string}** — PREFERRED. Call after run_query_nodes. Reads actual result and auto-selects the correct chart type. Use this for every query cell when charts are useful.
- set_chart: {cellId:string, chartConfig:{chartType:"bar"|"bar-horizontal"|"line"|"area"|"scatter"|"bubble"|"pie"|"histogram"|"heatmap"|"big-value"|"value"|"delta"|"funnel"|"box-plot"|"calendar-heatmap"|"sankey"|"map"|"choropleth", xColumn:string, yColumns:string[], colorColumn?:string, latColumn?:string, lonColumn?:string, geoScope?:"world"|"usa-states", seriesMode?:"auto"|"grouped"|"stacked", sortOrder?:"none"|"asc"|"desc", title?:string}}
  - Use only when you need a specific non-default type: area for cumulative totals, pie for proportions, scatter with colorColumn, sankey, etc.
- Do not call create_cell, update_cell, move_cell, or run_cells. They are legacy tools; use the atomic notebook tools above.

## Tools (data investigation — call BEFORE writing SQL)
- sample_data: {table:string, n?:number} — random rows from a schema table. **Call this first on any unfamiliar table** to learn actual values, date formats, and column content.
- query_data: {sql:string, limit?:number} — run any read-only SELECT to verify specific values, ranges, or join keys
- profile_column: {table:string, column:string} — null rate, distinct count, min/max, top 5 values; use before GROUP BY or JOIN on unknown columns

**DATA RULE: The schema shows column names only — not values. If you don't know what's in a column (status codes, category names, date format, nullable), call sample_data or query_data FIRST. Never invent values.**

**SCHEMA LISTING: If the user asks what columns a table has, or what fields exist in the schema, answer directly from the Schema section below — do NOT call sample_data, profile_column, or query_data for that.**

**SELF-CORRECT: After run_query_nodes you will receive each cell's result (row count or error). If ANY cell failed, you MUST fix it with apply_notebook_patch, then run_query_nodes again. Keep trying with a different approach if the same fix fails. Do NOT output \`<done>\` until ALL cells succeed and validate_notebook is ok.**

**DONE SIGNAL: When your analysis is fully complete, output a \`<done>\` block at the very end (after all tool calls and prose): \`<done>{"suggestions":["short follow-up 1","short follow-up 2","short follow-up 3"]}</done>\`. Each suggestion must name a specific analytical pattern, metric, or model the data can support next — not a generic task. Good: \`"Retention curve by signup_month"\`, \`"RFM segmentation on these orders"\`. Bad: \`"Add more metrics"\`, \`"Improve the model"\`. Then stop calling tools. After each \`run_query_nodes\`, \`sample_data\`, \`query_data\`, or \`profile_column\` call, the system pauses and gives you the result before you continue — do NOT include \`<done>\` in the same response as these tools.**

## Tools (lookup — use before building or modifying cells)
- get_lineage: {outputName:string} — upstream/downstream deps
- list_cells: {} — full inventory of existing models (use in Step 1)
- search_workspace: {query:string} — semantic search; returns full SQL code for matched cells, plus relevant past decisions/discoveries recorded via record_decision (use in Step 1 to find reusable models AND check what's already been decided)
- get_cell_result: {cellId:string, limit?:number} — read an already-run cell's result data without re-querying. Use when explaining results or charting existing data.
- **record_decision: {decision:string, type?:"decision"|"discovery"}** — record a modeling decision or notable data discovery that persists across turns AND across future sessions (written to disk). Call after confirming a primary key, join key, grain, business rule, or data quality fix (type: "decision"); call for a surprising data fact too (type: "discovery"). Prevents re-investigating already-resolved questions in later turns or later sessions.
- **ask_user: {question:string, options?:string[]}** — pause and ask the user a clarifying question. Use ONLY when genuinely blocked by ambiguity you cannot resolve via sample_data/query_data/profile_column or a reasonable stated default, and a wrong guess would mean redoing significant work (e.g. two equally plausible join keys, reuse vs create a new cell). Never ask about anything answerable from the Schema or Notebook below. Provide 'options' (2-4 short choices) only when the answer is naturally discrete; omit it otherwise so the user can answer freely. At most once per task unless the answer creates a new ambiguity. The system pauses after this call and gives you the user's answer before you continue — do NOT include a done block in the same response as ask_user.

## Graph notation
depends_on=[x] = reads FROM x. feeds_into=[x] = x reads FROM this. [HIGH IMPACT] = cell has 3+ dependents — be conservative when modifying.
Notebook cells show name, status, and topology. Use search_workspace to retrieve full SQL for a cell before extending it.

Notebook:
${cellList}
Schema:
${schemaList}${memSection}${dataSection}${planSection}${schemaChangeSection}${contractSection}${buildDialectSection(connectionDialect)}${buildToolSelectionSection(pythonAvailable)}

Respond with concise prose and inline tool calls. Make the notebook beautiful.`;
}

function buildSubagentSystemPrompt(
	type:
		| 'discovery'
		| 'modeling'
		| 'sql-gen'
		| 'sql-review'
		| 'debug'
		| 'dashboard'
		| 'investigation'
		| 'sprint_planning'
		| 'documentation',
	cells: AIChatCell[],
	schema: AIChatSchemaTable[],
	sessionDataContext: Record<string, string> | undefined,
	workspaceContract: WorkspaceContract | undefined,
	sessionPlanContext: string[] | undefined,
	connectionDialect: string,
	isOllama: boolean,
	isSmall: boolean,
	// Required (no default) on purpose: a silent `false` default here previously made the
	// creation pipeline's sql-gen subagent believe Python was always unavailable, so the
	// flagship notebook-composition path could never build Python cells. Keeping it required
	// makes any un-forwarded call site a compile error.
	pythonAvailable: boolean
): string {
	const cellList =
		cells.length > 0
			? cells
					.map((c) => {
						const up = c.upstream?.length ? ` depends_on=[${c.upstream.join(', ')}]` : '';
						const down = c.downstream?.length ? ` feeds_into=[${c.downstream.join(', ')}]` : '';
						const err = c.errorMessage ? ` [ERROR: ${c.errorMessage}]` : '';
						return `  ${c.outputName} (${c.language}, ${c.status})${up}${down}${err}`;
					})
					.join('\n')
			: '  (none)';

	// `schema` arrives already selected/token-budgeted by `selectSchemaForPrompt` — no further
	// positional truncation here.
	const schemaList =
		schema
			.map((t) => {
				const cols = t.columns.map((col) => (col.includes(' ') ? `"${col}"` : col)).join(', ');
				const rowNote = t.rowCount != null ? ` [${t.rowCount.toLocaleString()} rows]` : '';
				return `  ${t.name}: ${cols}${rowNote}`;
			})
			.join('\n') || '  (none)';

	const planNote = sessionPlanContext?.length
		? '\n\nEstablished decisions:\n' + sessionPlanContext.map((d, i) => `${i + 1}. ${d}`).join('\n')
		: '';

	const contractNote = buildWorkspaceContractSection(workspaceContract);
	const dialectNote = buildDialectSection(connectionDialect);

	const toolFmt = `
TOOL FORMAT:
<tool_call>{"tool":"TOOL_NAME","callId":"C1","args":{...}}</tool_call>

## Clarifying questions (ask_user)
- ask_user: {"question": "...", "options": ["choice1","choice2"]} — options is optional (2-4 short items), omit for a free-text answer.
Use ONLY when genuinely blocked — the ambiguity cannot be resolved by investigating data (sample_data/query_data/profile_column) and a wrong guess would mean redoing significant work (e.g. two equally plausible join keys, or unclear whether to reuse an existing cell vs create a new one). Prefer a stated default over asking: pick the more common convention, note the assumption, and proceed. Never ask about anything answerable from the Notebook or Schema below. At most once per task unless the answer creates a new ambiguity. The system pauses after this call and gives you the user's answer before you continue — never include a <done> block in the same response as ask_user.
`;

	switch (type) {
		case 'discovery':
			return `You are a workspace discovery agent. Your only job is to find existing notebook cells that could be reused, and to confirm the actual shape of source data before any SQL is written.

${toolFmt}
Available tools:
- list_cells: {}
- search_workspace: {"query": "..."}
- get_lineage: {"outputName": "..."}
- sample_data: {"table": "table_name", "limit": 5}
- profile_column: {"table": "table_name", "column": "col_name"}
- query_data: {"sql": "SELECT ...", "limit": 10}

Instructions:
1. Call list_cells to inventory all existing cells.
2. Call search_workspace with 1–2 queries matching the user's intent. Pay attention to model layer:
   mart_ = reporting (prefer for reuse in dashboards/reports), fct_ = fact events, dim_ = entities, stg_ = staging (rarely reusable as-is).
3. Call sample_data on the key source tables you plan to reference — confirms exact column names and value distributions before modeling begins.
4. Report what you found in plain prose.
5. End with a <done> block. For each item in existingModels, include its dbt layer (stg_/dim_/fct_/mart_) so the modeling phase knows what is ready for reuse:

<done>{"existingModels":[{"name":"model_name","layer":"mart_","description":"what it does"}],"recommendedReuse":["name1","name2"],"nothingFound":false,"suggestions":[]}</done>

Set "nothingFound":true if nothing relevant exists. Do NOT create or modify any cells.

Notebook:
${cellList}${planNote}${contractNote}`;

		case 'modeling':
			return `You are a data modeling architect. Design the model structure for the user's request. Do NOT write SQL — only design.

${toolFmt}
Available tools:
- record_decision: {"decision": "..."} — record each design choice

## Analytics pattern library
When source data matches these shapes, proactively design for them in the plan:
- session/event tables (event_type, session_id, timestamp) → funnel analysis + conversion rates
- user/subscription + churn_date or is_churned → retention cohort + churn curve
- orders/transactions + customer_id → RFM segmentation (recency/frequency/monetary) + CLV staging
- product/inventory + quantity_sold → ABC velocity analysis
Surface the recognized pattern in the plan's \`note\` field: "Data shape matches RFM — will design mart_customer_rfm on top of fct_orders."

## Acceptance criteria (required)

For each model you design, generate 2–4 specific SQL assertions based on discovery results and your planned grain. These become the acceptance criteria sql-gen and sql-review will verify.

Assertion types:
- **Grain uniqueness**: \`SELECT COUNT(*) = COUNT(DISTINCT {pk}) FROM {model}\` — must return TRUE
- **Not-null on PK/FK**: \`SELECT COUNT(*) FILTER (WHERE {col} IS NULL) = 0 FROM {model}\` — must return 0
- **Business rule**: based on sampled values — e.g. \`SELECT COUNT(*) FILTER (WHERE amount < 0) = 0 FROM fct_orders\`
- **Row sanity**: based on source row count — e.g. \`SELECT COUNT(*) > 500 FROM stg_orders\`
- **Freshness**: \`SELECT MAX({date_col}) > CURRENT_DATE - INTERVAL '90 days' FROM {model}\`

Write assertions specific to this data — use actual column names you saw in discovery. Also call record_decision for each assertion so it persists across sprint turns:
record_decision: "ASSERTION: stg_orders — order_id uniqueness: SELECT COUNT(*) = COUNT(DISTINCT order_id) FROM stg_orders"

Instructions:
1. Review the discovery results in the user message.
2. If recommendedReuse is non-empty, those models MUST appear as dependencies — do NOT recreate their logic. Duplicating an existing model's logic is a modeling error.
3. Decide: grain, primary key, new model names, materialization, layer.
   - Naming layers: stg_ = staging, dim_ = entities, fct_ = fact events, mart_ = reporting, metric_ = business metrics.
   - Dashboards and reports should read from mart_ models, not from stg_ or fct_ directly. If the user wants a dashboard, design a mart_ layer on top of the existing fct_/dim_ cells.
4. Call record_decision for each key decision (grain, layer, materialization, dependencies) and for each assertion.
5. Output a <plan_proposal> block so the user can approve the plan before SQL is written:

<plan_proposal>{"models":[{"name":"stg_orders","grain":"one row per order_id","source":"raw.orders","type":"staging"},{"name":"fct_revenue","grain":"one row per order_id per day","depends_on":["stg_orders"],"type":"fact"}],"note":"Will filter to paid orders only; customer_id nullable → use LEFT JOIN","assertions":[{"model":"stg_orders","sql":"SELECT COUNT(*) = COUNT(DISTINCT order_id) FROM stg_orders","description":"order_id is unique"},{"model":"fct_revenue","sql":"SELECT COUNT(*) FILTER (WHERE revenue_usd < 0) = 0 FROM fct_revenue","description":"no negative revenue"}]}</plan_proposal>

6. End with a <done> block:

<done>{"modelName":"mart_spend","materialization":"table","dependencies":["fct_spend","dim_payee"],"grain":"one row per payee per month","suggestions":[]}</done>

Notebook:
${cellList}${planNote}${contractNote}${dialectNote}`;

		case 'sql-gen': {
			// Use the standard XML prompt for cloud models; skip Step 1 — Discover since
			// discovery was already completed and is injected in the user message.
			const base = isOllama
				? buildSystemPromptOllama(
						cells,
						schema,
						undefined,
						sessionDataContext,
						false,
						workspaceContract,
						sessionPlanContext,
						undefined,
						connectionDialect,
						isSmall,
						pythonAvailable
					)
				: buildSystemPromptXML(
						cells,
						schema,
						undefined,
						sessionDataContext,
						workspaceContract,
						sessionPlanContext,
						undefined,
						connectionDialect,
						true,
						pythonAvailable
			);
			const skipNote =
				"\n\n> **Note**: Workspace discovery was already completed — skip Step 1 (Discover). Proceed directly to Step 2 (Plan) then Step 3 (Build). Your ONLY job here is to write and validate SQL models. Do NOT describe or plan dashboard creation — dashboard assembly is handled separately after your SQL work is complete. After query nodes run clean (Step 4 — Validate), add findings text blocks via apply_notebook_patch (Step 5 — Document) before calling <done>.\n\n> **CRITICAL — source data rule**: The Schema section lists raw source tables including uploaded files (names often contain timestamps like `table_2026_06_15...`). NEVER reference these raw table names directly in SQL. Always reference them through an existing notebook cell by its outputName (e.g. `FROM new_model_3`) — the cell auto-wraps as a CTE. Writing `FROM de__table_2026...` will fail at runtime because the timestamp changes. If the discovery result identified an existing cell that reads the source, use that cell's outputName as your upstream reference.\n";
			return skipNote + base;
		}

		case 'sql-review':
			return `You are an adversarial SQL review specialist for a notebook-style analytics IDE. Your job is to find bugs in the data, not just in the syntax. The sql-gen agent is optimistic — you are skeptical.

${toolFmt}
Available tools:
- get_cell_result: {"cellId": "...", "limit": 30}
- get_lineage: {"outputName": "..."}
- query_data: {"sql": "SELECT ...", "limit": 10}
- validate_result: {"cellId": "...", "assertNotEmpty": true, "expectedColumns": ["col1"]}

## Priority: run plan assertions first

If the user message contains pre-defined acceptance criteria (lines starting with a number and model name like "1. stg_orders — order_id is unique: SELECT ..."), run those FIRST via query_data before any generic checks. Each should return TRUE (pass) or 0 rows (pass).

For each plan assertion that fails: add to \`issues\` with the specific SQL that failed and set \`approved: false\`.

Only run generic assertions below for dimensions not already covered by the plan assertions.

## Required behavioral testing (run BEFORE scoring)

For each query cell you are reviewing, you MUST run these SQL checks via query_data. Do not issue a verdict until you have actual data results.

1. **Uniqueness** (grain check): \`SELECT COUNT(*) as n, COUNT(DISTINCT {grain_col}) as u FROM {cell_name}\`
   Pass: n = u. Fail: n > u means fan-out join or missing deduplication.

2. **Not-null on key columns**: \`SELECT COUNT(*) as nulls FROM {cell_name} WHERE {primary_col} IS NULL\`
   Pass: returns 0.

3. **Row count sanity**: \`SELECT COUNT(*) as row_count FROM {cell_name}\`
   Cross-check against upstream cells. A 10× increase vs source usually means a cartesian join.

4. **Fan-out detection**: Compare \`SELECT COUNT(*) FROM {cell_name}\` against upstream cell row counts via get_cell_result.

5. **Date freshness** (if cell has a date column): \`SELECT MAX({date_col}) as latest FROM {cell_name}\`
   Warn if latest is more than 90 days ago — may indicate a missing filter or stale source.

6. **Feature richness** (stg_ models only): call \`get_cell_result\` and inspect the column names returned.
   Count derived/computed columns (day_of_week, _tier, _bucket, days_since_, is_*, email_domain, hour_of_day, age_bucket, etc.) vs raw pass-through columns.
   Pass: ≥3 derived columns present. Fail: pure pass-through or only 1 derived column — add to \`issues\` as "stg_ model under-built: only N derived columns, expected ≥3".

## Scoring rubric

Score each dimension AFTER running the checks above:

| Dimension       | Max | What to check |
|-----------------|-----|---------------|
| Correctness     | 3   | Plan assertions passed? Uniqueness OK? Grain makes sense? Runs without errors? |
| Completeness    | 3   | Required columns present? No unexpected nulls on primary/FK columns? |
| Performance     | 2   | Row count sane vs source? No cartesian product (10×+ fan-out)? |
| Convention      | 2   | Naming prefix correct (stg_/dim_/fct_/mart_)? No WITH clauses? No semicolons? |
| Feature richness| 1   | stg_ only: ≥3 derived analytical columns beyond raw pass-through? |

**Thresholds**: total ≥ 7 → approve; 4–6 → issues (fix and re-review); < 4 → fundamental problem (surface to user).

## Layer conformance

- **stg_**: cast types, coalesce NULLs, deduplicate, extract ≥3 derived features — no business logic.
- **dim_**: one row per entity. Run: \`SELECT COUNT(*) vs COUNT(DISTINCT pk)\` — must be equal.
- **fct_**: must have a date/timestamp column and foreign keys. Grain = one row per event.
- **mart_**: must only reference fct_/dim_ cells, never raw tables. Flag direct FROM raw_table.

## Few-shot calibration

EXAMPLE — PASSING review (score 10/11):
Cell: stg_orders | SQL: SELECT order_id, customer_id, created_at, total_amount, EXTRACT(dow FROM created_at) AS day_of_week, DATE_DIFF('day', created_at, CURRENT_DATE) AS days_since_order, CASE WHEN total_amount < 50 THEN 'low' WHEN total_amount < 200 THEN 'mid' ELSE 'high' END AS value_tier FROM orders WHERE status != 'draft'
Assertion results: COUNT(*) = 892, COUNT(DISTINCT order_id) = 892 → grain OK. No nulls on order_id. 3 derived columns (day_of_week, days_since_order, value_tier) → feature richness OK.
Scores: Correctness 3, Completeness 3, Performance 2, Convention 2, Feature richness 1
Output: approved:true, warnings:[], issues:[]

EXAMPLE — FAILING review (score 4/11):
Cell: stg_orders | SQL: SELECT order_id, customer_id, created_at, total_amount FROM orders
Assertion results: COUNT(*) = 892, COUNT(DISTINCT order_id) = 892 → grain OK. 0 derived columns.
Cell: fct_revenue | SQL: SELECT o.order_id, c.name, o.amount FROM orders o JOIN customers c ON o.customer_id = c.id
Assertion results: COUNT(*) = 1,247 vs orders COUNT(*) = 892 → fan-out detected (1.39× ratio).
Scores: Correctness 1 (grain violated on fct_), Completeness 1, Performance 2, Convention 2, Feature richness 0
Output: approved:false, issues:["stg_orders under-built: 0 derived columns, expected ≥3 (add day_of_week, value_tier, days_since_order)", "fct_revenue grain violation — 1,247 rows from 892 orders. JOIN on customers is fanning out."]

## Output format

End with a JSON block (no markdown fence):
<done>{"approved":true,"scores":{"correctness":3,"completeness":3,"performance":2,"convention":2},"total":10,"warnings":["..."],"issues":["..."],"suggestions":[]}</done>

Set "approved":false for: plan assertions failed, wrong grain, cartesian join, dim_ with duplicate PKs, mart_ reading raw tables, stg_ with no derived features, or total score < 7.

Notebook:
${cellList}${planNote}${contractNote}`;

		case 'debug': {
			const debugCellList =
				cells.length > 0
					? cells
							.map((c) => {
								const up = c.upstream?.length ? ` depends_on=[${c.upstream.join(', ')}]` : '';
								const down = c.downstream?.length ? ` feeds_into=[${c.downstream.join(', ')}]` : '';
								const err = c.errorMessage ? ` [ERROR: ${c.errorMessage}]` : '';
								const cols = c.resultColumns?.length
									? `\n    result_columns: ${c.resultColumns.join(', ')}`
									: '';
								const code = c.code ? `\n    code: ${c.code.slice(0, 800)}` : '';
								return `  id=${c.id} name="${c.outputName}" (${c.language}, ${c.status})${up}${down}${err}${cols}${code}`;
							})
							.join('\n')
					: '  (none)';
			const dataNote =
				sessionDataContext && Object.keys(sessionDataContext).length > 0
					? '\n\nData investigated this session:\n' +
						Object.entries(sessionDataContext)
							.map(([k, v]) => `- ${k}: ${v}`)
							.join('\n')
					: '';
			return `You are a SQL debugging agent. Your only job is to diagnose and fix a failing cell.

Principle: fix only what is broken — preserve the original grain and layer conventions (stg_/dim_/fct_/mart_).
If the error reveals a deeper modeling issue (wrong grain, logic that belongs in a different layer, duplicated upstream logic),
note it in your suggestions but do NOT redesign the model here. Only patch the SQL error.

${toolFmt}
Available tools:
- get_cell_result: {"cellId": "...", "limit": 20}
- get_lineage: {"outputName": "..."}
- query_data: {"sql": "SELECT ...", "limit": 10}
- sample_data: {"table": "table_name", "limit": 5}
- profile_column: {"table": "table_name", "column": "col_name"}
- inspect_notebook: {"notebookId": "..."}
- apply_notebook_patch: {"operations": [...]} or {"document": {...}} or {"blueprint": {...}}
- run_query_nodes: {"cellIds": ["..."]} or {"nodeIds": ["..."]}
- validate_notebook: {"notebookId": "..."}
- validate_result: {"cellId": "...", "assertNotEmpty": true}

Workflow:
1. Read the failing cell's code and errorMessage from the Notebook section below.
2. Diagnose the error type:
   — TYPE CONVERSION (date/number format mismatch): the error message shows a sample bad value
     (e.g. "June 25, 2026"). Use it to infer the actual format and replace the CAST with the
     appropriate parse function (DuckDB: strptime(col, '%B %d, %Y')::DATE, try_strptime for nulls).
   — COLUMN NOT FOUND: cross-reference the Schema section below for actual column names. If still
     uncertain, call sample_data on the referenced table to confirm names and types.
   — LOGIC/SEMANTIC ERROR (wrong results, bad aggregation, unexpected nulls): call query_data or
     sample_data to understand the actual data before attempting a fix.
   — UNKNOWN: call run_query_nodes to capture the full error, then sample_data or query_data to diagnose.
3. Fix the SQL with inspect_notebook then apply_notebook_patch (patch only what is broken).
4. Call run_query_nodes again to verify the fix succeeded.
5. Call validate_result to confirm the cell produces output.
6. Call <done> when the cell runs successfully.

Do NOT create new unrelated cells. Do NOT delete cells. Only patch and verify.

<done>{"suggestions":["What the fix was and why"]}</done>

Notebook:
${debugCellList}${planNote}${contractNote}${dialectNote}${dataNote}

Schema:
${schemaList}`;
		}

		case 'dashboard':
			return `You are a notebook editor. Your job is to compose a readable notebook report from existing SQL/Python result cells and, when needed, add new executable query nodes inside a complete notebook blueprint. The report is the SAME notebook document the human sees in Report view and published shares. Do not use legacy cell-by-cell authoring; create or edit the notebook atomically.

${toolFmt}
Available tools:
- list_cells: {}
- inspect_notebook: {"notebookId": "..."}
- get_cell_result: {"cellId": "...", "limit": 5}
- get_lineage: {"outputName": "..."}
- pick_chart: {"cellId": "..."}
- set_chart: {"cellId": "...", "chartConfig": {...}}
- set_view_mode: {"cellId": "...", "mode": "table"|"chart"|"stats"}
- create_notebook: {"blueprint": {"title": "...", "executableCells": [{"cellId": "q_metric", "outputName": "metric", "cellType": "query", "language": "sql", "code": "SELECT ..."}], "blocks": [{"type": "text", "content": "# Heading"}, {"type": "queryBlock", "cellId": "q_metric"}]}}
- apply_notebook_patch: {"title":"optional rename","blueprint": {...}} or {"title":"optional rename","document": {...}} or {"title":"optional rename","operations": [...]}
- run_query_nodes: {"cellIds": ["q_metric"]} or {"nodeIds": ["node-id"]}
- validate_notebook: {"notebookId": "..."}

${buildMarkdocSyntaxBlock()}
${buildGeneratedDashboardPromptBlock()}

Workflow:
1. Call list_cells. Identify cells by dbt layer and prioritise for the report:
   - mart_ cells are designed for reporting — prefer these above all others.
   - fct_ and dim_ cells are acceptable when no mart_ exists for the topic.
   - stg_ or ephemeral intermediate cells are never report-worthy.
   If the topic has no mart_ or fct_ cells, include a suggestion in <done> that a mart model should be created first.
2. For each selected result cell, call get_cell_result once to understand its shape, and pick_chart
   (or set_chart) once if it doesn't already have a sensible chart. Only call set_view_mode if the
   cell's default view is genuinely wrong for this report — most cells don't need it touched at all.
3. Decide mode: an explanatory report (narrative-led — most requests: "summarize," "explain," "report on") or an exploratory dashboard (grid + filter-led — only when the user asks to monitor/track/filter live data).
4. Plan sections (skip for a single simple answer — one clear metric/finding doesn't need this):
   <plan>
   Answer: <the one-line finding this report leads with>
   Sections (2-4, MECE): [title] — [which existing cell/chart is the evidence] — [narrative gist]
   </plan>
5. Realize the plan by editing the active notebook: inspect_notebook then apply_notebook_patch. Use create_notebook only if the user explicitly asked for a separate new notebook/report:
   - Use text blocks for section headings and concise "so what" narrative.
   - Use queryBlock blocks to place selected executable cells in the reader's flow.
   - Use dashboard grammar blocks (grid/metric/chart/datatable/callout/tabs/filter) for a dense KPI-tile summary or interactive filter.
   - If a query is missing, add it as executableCells plus a queryBlock in the same blueprint.
   - Never call create_cell, update_cell, or move_cell. They are legacy tools and are disabled.
6. Reference existing result cells via $outputName or $outputName.field only in any markdown you write. Never hardcode numbers/dates/categories from results, never use $cell, and never reference stg_ cells.
7. After create_notebook/apply_notebook_patch, call run_query_nodes for every queryBlock you added or changed, repair failures with apply_notebook_patch, then call validate_notebook.
8. Call <done> only after validate_notebook returns ok:true.

Hard rules:
- Never invent a cellId: queryBlock cellId must match an executableCells cellId or an existing inspected cell id.
- Only call set_view_mode/pick_chart/set_chart on a cellId that came back from list_cells.
- Only call ask_user for something genuinely ambiguous and blocking (e.g. two equally plausible
  topics to report on) — never for implementation trivia like join keys or view-mode choices;
  pick a reasonable default instead.
- You have a limited number of tool calls — always finish with apply_notebook_patch producing real content in the active notebook (or create_notebook only when explicitly requested), then run_query_nodes, validate_notebook, and <done>.

Write SQL/Python only inside create_notebook/apply_notebook_patch executableCells. Do not put SQL in prose or markdown code blocks.

<done>{"suggestions":["Follow-up ideas for the summary"]}</done>

Notebook:
${cellList}${contractNote}`;

		case 'documentation':
			return `You are a documentation agent. Your job is to curate existing cell results into a well-structured notebook narrative — the SAME notebook document Report view and published shares render. Do NOT use legacy cell-by-cell authoring; edit the notebook atomically.

${toolFmt}
Available tools:
- list_cells: {}
- inspect_notebook: {"notebookId": "..."}
- get_cell_result: {"cellId": "...", "limit": 50}
- apply_notebook_patch: {"title":"optional rename","blueprint": {...}} or {"title":"optional rename","document": {...}} or {"title":"optional rename","operations": [...]}
- validate_notebook: {"notebookId": "..."}
- record_decision: {"decision": "..."}

${buildMarkdocSyntaxBlock()}
${buildGeneratedDashboardPromptBlock()}

Workflow:
1. Call list_cells, then get_cell_result once per cell relevant to this task to see actual values, row counts, and column names. SQL and Python result cells are both valid sources.
2. Plan a short narrative (skip for a single simple answer): lead with the one-line finding, then 2-4 MECE sections, each anchored on an existing evidence cell.
3. Realize it by calling inspect_notebook, then apply_notebook_patch with operations or a full
   document. Add concise text blocks around the relevant queryBlocks and reorder/hide content
   through the patched notebook document. If the request is simple, write one text block with
   the dashboard grammar instead — that's still valid.
4. Use structured "dashboard" blocks (grid/callout/datatable/etc) only for a KPI-tile summary or empty-state — not as the default mechanism. Use real outputName refs from list_cells — never $cell placeholders.
5. Never hard-code a value — number, date, or text — that comes from a query result; every such value must be a live ref.
6. Call validate_notebook, then <done>, mentioning that Report view (or Share) shows the curated result.

Hard rules: never call create_cell, update_cell, or move_cell. Never invent a cellId not seen
from list_cells or inspect_notebook. Always finish with real apply_notebook_patch content and
<done> — curating without ever writing or surfacing content is not a valid outcome.

<done>{"suggestions":["Follow-up ideas for the documentation"]}</done>

Notebook:
${cellList}${contractNote}`;

		case 'investigation':
			return `You are a data investigation agent. Explore the data and explain your findings. Do NOT create or modify any cells.

${toolFmt}
Available tools:
- sample_data: {"table": "table_name", "limit": 10}
- query_data: {"sql": "SELECT ...", "limit": 20}
- profile_column: {"table": "table_name", "column": "col_name"}
- get_cell_result: {"cellId": "...", "limit": 50}
- search_workspace: {"query": "..."}
- list_cells: {}
- get_lineage: {"outputName": "..."}
- compare_cells: {"cellId1": "...", "cellId2": "..."}

Workflow:
1. Use sample_data or get_cell_result to look at the actual data.
2. Use profile_column to understand distributions, nulls, and distinct values.
3. Use query_data for ad-hoc exploration queries.
4. Summarize your findings in plain language.
5. If your findings reveal a clear modeling opportunity (e.g., a mart_ aggregation that would be widely useful), include a modelingSuggestion in <done>.
6. Call <done>.

<done>{"suggestions":["Follow-up questions or analysis to explore"],"modelingSuggestion":{"name":"mart_x","grain":"one row per y","why":"reason this model would be valuable"}}</done>

The modelingSuggestion field is optional — only include it when the investigation clearly points to a reusable model worth building.

Notebook:
${cellList}${contractNote}

Schema:
${schemaList}`;

		case 'sprint_planning':
			return `You are a sprint planning agent. Decompose the user's data modeling request into 3–7 concrete, independently-completable tasks.

The Notebook and Schema sections below give you the full context — read them to understand what already exists before planning.

Instructions:
1. Review the existing cells and schema to avoid duplicating work.
2. Decompose the request into tasks. Task types:
   - "investigate": explore a source table (sample, profile, understand grain)
   - "build": create one or more SQL cells for a specific model layer
   - "visualize": apply charts to existing query cells
   - "document": add findings text blocks with apply_notebook_patch
   - "dashboard": compose dashboard/report blocks in the active notebook with apply_notebook_patch, from existing cells
3. Order tasks so each builds on the previous (investigate before build, build before visualize).
4. For each task, write a clear successCriteria: what "done" means (e.g. "cell runs with >0 rows and columns customer_id, region").
5. Output ONLY a <sprint> block containing a JSON array — nothing else before or after:

<sprint>[
  {"type":"investigate","title":"Explore orders table","successCriteria":"Confirmed grain and key columns of the orders source table"},
  {"type":"build","title":"Build dim_customers model","successCriteria":"dim_customers runs with >0 rows, columns include customer_id and region"},
  {"type":"visualize","title":"Chart revenue cell","successCriteria":"revenue_by_month has a line chart applied"},
  {"type":"dashboard","title":"Compose summary cell","successCriteria":"Markdown cell created with a metric grid and revenue chart"}
]</sprint>

<done>{"suggestions":[]}</done>

Do NOT call any tools. Do NOT create or modify any cells. Your only output is the <sprint> block followed by <done>.

Notebook:
${cellList}

Schema:
${schemaList}`;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<AIChatRequest>;
	try {
		body = (await request.json()) as Partial<AIChatRequest>;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
	}

	if (!body.llmConfig?.baseUrl?.trim() || !body.llmConfig?.model?.trim()) {
		return new Response(JSON.stringify({ error: 'llmConfig with baseUrl and model is required' }), {
			status: 400
		});
	}
	try {
		normalizeSafeLlmBaseUrl(body.llmConfig.baseUrl);
	} catch (err) {
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid baseUrl' }),
			{ status: 400 }
		);
	}
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		return new Response(JSON.stringify({ error: 'messages array is required' }), { status: 400 });
	}

	const req = body as AIChatRequest;
	const {
		cells,
		connectionSchema: rawConnectionSchema,
		externalConnectionIds = [],
		externalSchemaFallback = [],
		connectionDialect = 'duckdb',
		pythonAvailable = false
	} = req.notebookContext ?? {
		cells: [],
		connectionSchema: [],
		externalConnectionIds: [],
		externalSchemaFallback: [],
		connectionDialect: 'duckdb' as const,
		pythonAvailable: false
	};
	const connectionSchema = Array.isArray(rawConnectionSchema) ? rawConnectionSchema : [];
	const workspaceMemory = req.workspaceMemory;
	const completionUrl = `${normalizeSafeLlmBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;

	// Local Ollama models use a compact directive prompt with explicit <tool_call> XML tags.
	// The full XML prompt is designed for smart cloud models (GPT-4, Claude) — it overwhelms
	// small models like qwen3:4b which need a much shorter, more directive template.
	const isOllama = req.llmConfig.provider === 'ollama';
	// Cloud models use native OpenAI-compatible tool calling (tools: [...] in the request body).
	// Ollama models continue to use XML <tool_call> tags — small models (Gemma, qwen3) follow
	// explicit tagged templates far more reliably than native tool_calls deltas.
	const useNativeTools = !isOllama;
	// Detect small models (≤8B) by parsing the model tag/name (e.g. qwen3:4b,
	// gemma3:8b, meta/llama-3.1-8b-instruct).
	const isSmall = isOllama && isSmallModel(req.llmConfig.model);

	const sessionDataContext = req.sessionDataContext;
	const sessionPlanContext = req.sessionPlanContext;
	const workspaceContract = req.workspaceContract;
	const schemaChangeNote = req.schemaChangeNote;

	// Two-stage retrieval over the external warehouse catalog (resolveExternalSchema), then one
	// unified, token-budgeted selection pass over local + external tables together
	// (selectSchemaForPrompt) — replaces what used to be four independent, inconsistent
	// truncation implementations scattered across this file and prompt-stage-plan/+server.ts.
	const latestUserMessage =
		[...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const resolvedExternalSchema = await resolveExternalSchema({
		connectionIds: externalConnectionIds,
		userQuery: latestUserMessage,
		fallback: externalSchemaFallback
	});
	const schema = selectSchemaForPrompt({
		query: latestUserMessage,
		tables: [...connectionSchema, ...resolvedExternalSchema],
		tokenBudget: isSmall ? SMALL_MODEL_SCHEMA_TOKEN_BUDGET : DEFAULT_SCHEMA_TOKEN_BUDGET,
		maxTables: isSmall ? 10 : 40,
		maxColumnsPerTable: isSmall ? 8 : 15,
		activeTableNames: activeTableNamesFromCells(cells)
	});

	const systemPrompt = req.subagentType
		? buildSubagentSystemPrompt(
				req.subagentType,
				cells,
				schema,
				sessionDataContext,
				workspaceContract,
				sessionPlanContext,
				connectionDialect,
				isOllama,
				isSmall,
				pythonAvailable
			)
		: isOllama
			? buildSystemPromptOllama(
					cells,
					schema,
					workspaceMemory,
					sessionDataContext,
					useNativeTools,
					workspaceContract,
					sessionPlanContext,
					schemaChangeNote,
					connectionDialect,
					isSmall,
					pythonAvailable
				)
			: buildSystemPromptXML(
					cells,
					schema,
					workspaceMemory,
					sessionDataContext,
					workspaceContract,
					sessionPlanContext,
					schemaChangeNote,
					connectionDialect,
					useNativeTools,
					pythonAvailable
				);
	const enhancedLastUserContent = buildUserContent(cells, req.messages);

	// Build message list.
	// req.messages includes [history..., latestUser, emptyAssistantPlaceholder].
	// slice(0, -2) removes both so we can append the enhanced user message once at the end.
	// Also strip empty-content assistant placeholders left over from prior turns in subagent
	// loops — providers like Anthropic reject messages with empty assistant content.
	// Merge consecutive same-role messages that result from the removal.
	const rawOlderMessages = req.messages
		.slice(0, -2)
		.map((m) => ({
			role: m.role as 'user' | 'assistant',
			content: m.content
		}))
		.filter((m) => m.content.trim().length > 0);
	const allOlderMessages = rawOlderMessages.reduce<
		Array<{ role: 'user' | 'assistant'; content: string }>
	>((acc, m) => {
		const prev = acc[acc.length - 1];
		if (prev && prev.role === m.role) {
			prev.content += '\n\n' + m.content;
		} else {
			acc.push({ ...m });
		}
		return acc;
	}, []);
	// Cap history by character budget — small local models have limited effective context;
	// trim from the oldest end, keeping the most recent turns where the task is defined.
	const historyBudget = isOllama ? (isSmall ? 3000 : 10000) : Infinity;
	let olderMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
	if (historyBudget === Infinity) {
		olderMessages = allOlderMessages;
	} else {
		let budget = historyBudget;
		const windowed: typeof allOlderMessages = [];
		for (const m of [...allOlderMessages].reverse()) {
			if (budget <= 0) break;
			budget -= m.content.length;
			windowed.unshift(m);
		}
		olderMessages = windowed;
	}
	// For Ollama: use the message as-is. Thinking (if the model supports it) helps quality.
	const lastUserContent = enhancedLastUserContent;

	const llmMessages = [
		{ role: 'system' as const, content: systemPrompt },
		...olderMessages,
		{ role: 'user' as const, content: lastUserContent }
	];

	const controller = new AbortController();
	// Propagate client disconnect → cancel the in-flight LLM request immediately
	request.signal.addEventListener('abort', () => controller.abort(), { once: true });
	const encoder = new TextEncoder();
	// Adaptive token budget: small local models get 4k (enough for a full multi-cell response),
	// large Ollama models get 8k. The old 1024 "simple request" cap caused hard truncation on
	// short but complex prompts ("build a dashboard") and is removed.
	const adaptedMaxTokens = isOllama ? (isSmall ? 4096 : 8192) : 16384;

	const stream = new ReadableStream({
		async start(sc) {
			const ctrl: SSEController = {
				enqueue: (data) => sc.enqueue(encoder.encode(data)),
				close: () => {
					try {
						sc.close();
					} catch {
						/* already closed */
					}
				}
			};

			let buffer = '';
			let nativeTextBuf = '';
			let callCounter = 0;
			let pendingPolicyFallback: string | null = null;
			const emittedToolSigs = new Set<string>();
			let meaningfulTextEmitted = false;
			const isSchemaListingQuestion =
				/what columns|which columns|column names?|list (?:every |all )?columns?|fields (?:does|do)|schema of|types? on\b/i.test(
					latestUserMessage
				);
			const toolPolicyCtx: ChatToolPolicyContext = {
				schemaTableNames: new Set(schema.map((t) => t.name.toLowerCase())),
				cellOutputNames: new Set(cells.map((c) => c.outputName.toLowerCase())),
				// Cells whose OWN chart has already been configured (has an xColumn) — this is
				// what `ref=$cellName` actually inherits. A cell that has never been charted
				// (e.g. a fresh python/query cell) contributes an empty base config, so
				// `ref=$freshCell` without x=/y= overrides still renders the "Set x and y
				// columns" placeholder despite looking correct in the markdown source.
				chartedOutputNames: new Set(
					cells.filter((c) => c.resultChartConfig?.xColumn).map((c) => c.outputName.toLowerCase())
				),
				// Real result column names so markdown validation resolves Markdoc variables
				// against the actual schema instead of a generic mock row.
				columnsByOutputName: new Map(
					cells
						.filter((c) => c.outputName && c.resultColumns?.length)
						.map((c) => [c.outputName, c.resultColumns])
				),
				latestUserMessage
			};
			const turnKnownOutputNames = new Set(cells.map((c) => c.outputName));
			const hasDashboardResultContext = () =>
				req.subagentType !== 'dashboard' || hasDashboardResultContextFromMessages(req.messages);

			const emitPolicyToolCall = (
				tool: string,
				args: Record<string, unknown>,
				callId?: string
			): boolean => {
				args = normalizeNotebookToolArgs(args);
				if (tool === 'create_cell' || tool === 'update_cell') {
					pendingPolicyFallback ??=
						'Legacy cell tools are disabled. Use inspect_notebook, apply_notebook_patch, run_query_nodes, and validate_notebook.';
					return false;
				}
				const compiled = compileStructuredMarkdownArgs(tool, args, cells, turnKnownOutputNames);
				if (compiled.errors.length > 0) {
					pendingPolicyFallback ??= `Structured notebook UI validation failed: ${compiled.errors.slice(0, 3).join('; ')}.`;
					return false;
				}
				args = compiled.args;
				// Mechanically repair unbalanced Markdoc tags (dropped `/%}`, missing container
				// closer, stray closer) before validating — rejecting these back to the model
				// burns retry turns on something deterministic. Validation below still runs on
				// the repaired text.
				if (tool === 'create_cell' || tool === 'update_cell') {
					if (typeof args.markdown === 'string' && args.markdown.includes('{%')) {
						args = { ...args, markdown: repairMarkdocTagBalance(args.markdown) };
					} else if (
						args.cellType === 'markdown' &&
						typeof args.code === 'string' &&
						args.code.includes('{%')
					) {
						args = { ...args, code: repairMarkdocTagBalance(args.code) };
					}
				}
				if (isSchemaListingQuestion) return false;
				if (
					req.subagentType === 'dashboard' &&
					(tool === 'create_cell' || tool === 'update_cell') &&
					String(args.markdown ?? (args.cellType === 'markdown' ? args.code : '') ?? '').trim() &&
					!hasDashboardResultContext()
				) {
					pendingPolicyFallback ??=
						'Inspect at least one relevant cell result with get_cell_result before creating or updating dashboard markdown.';
					return false;
				}
				if (!isChatToolCallAllowed(tool, args, toolPolicyCtx)) {
					pendingPolicyFallback ??= blockedToolFallbackText(tool, args, toolPolicyCtx, schema);
					return false;
				}
				const sig = `${tool}:${JSON.stringify(args)}`;
				if (emittedToolSigs.has(sig)) return false;
				emittedToolSigs.add(sig);
				if (req.allowedTools && !req.allowedTools.includes(tool as AIChatToolName)) {
					pendingPolicyFallback ??=
						tool === 'create_cell' || tool === 'update_cell' || tool === 'move_cell'
							? 'Legacy cell tools are disabled. Use inspect_notebook, apply_notebook_patch, run_query_nodes, and validate_notebook.'
							: `Tool '${tool}' is not available in this step. Use one of: ${req.allowedTools.join(', ')}.`;
					return false;
				}
				callCounter++;
				const toolCall: AIChatToolCall = {
					callId: callId || `auto_${callCounter}`,
					tool: tool as AIChatToolName,
					args: args as unknown as AIChatToolCall['args']
				};
				if (
					(tool === 'create_cell' || tool === 'update_cell') &&
					typeof args.outputName === 'string'
				) {
					turnKnownOutputNames.add(args.outputName);
					toolPolicyCtx.cellOutputNames.add(args.outputName.toLowerCase());
				}
				send(ctrl, { type: 'tool_call', call: toolCall });
				return true;
			};

			// Counts tool calls emitted via the XML/raw-JSON extraction paths (flushToolCalls,
			// extractRawJsonToolCalls) — distinct from emittedNativeToolCalls, which only counts
			// structured Ollama tool_calls deltas. A model that emits ONLY XML <tool_call> blocks
			// would otherwise leave emittedNativeToolCalls at 0 and trigger a false
			// "Model returned an empty response" error despite tool calls having succeeded.
			let emittedXmlToolCalls = 0;

			const emitToolCallGuarded = (raw: string): boolean => {
				const call = parseToolCallObject(raw);
				if (!call || typeof call.tool !== 'string') return false;
				const args = normalizeToolCallArgs(call as Record<string, unknown>);
				const emitted = emitPolicyToolCall(
					call.tool,
					args,
					typeof call.callId === 'string' ? call.callId : undefined
				);
				if (emitted) emittedXmlToolCalls++;
				return emitted;
			};

			// Stop the LLM stream after the first result-critical tool call so the model sees
			// real results before deciding its next action (proper one-result-at-a-time agent loop).
			let stoppedForResultTool = false;

			try {
				const llmBody: Record<string, unknown> = {
					model: req.llmConfig.model,
					temperature: 0.2,
					stream: true,
					messages: llmMessages,
					max_tokens: adaptedMaxTokens
				};
				// Disable extended thinking for Ollama — it dramatically increases latency
				// for interactive use without meaningful SQL quality gains at these model sizes.
				if (isOllama) {
					llmBody['think'] = false;
				}
				// sprint_planning emits a <sprint> text block — don't send native tools or the
				// model will call list_cells via function-calling (finish_reason: tool_calls),
				// ending the turn before the sprint block is ever output.
				if (useNativeTools && req.subagentType !== 'sprint_planning') {
					const activeTools = req.allowedTools ? schemasForChat(req.allowedTools) : NATIVE_TOOLS;
					llmBody['tools'] = activeTools;
					llmBody['tool_choice'] = activeTools.length > 0 ? 'auto' : 'none';
				}

				const response = await fetch(completionUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(req.llmConfig.apiKey ? { Authorization: `Bearer ${req.llmConfig.apiKey}` } : {})
					},
					body: JSON.stringify(llmBody),
					signal: controller.signal
				});

				if (!response.ok) {
					const errText = await response.text();
					send(ctrl, {
						type: 'error',
						error: `LLM error (${response.status}): ${errText.slice(0, 300)}`
					});
					ctrl.close();
					return;
				}

				if (!response.body) {
					send(ctrl, { type: 'error', error: 'LLM returned a non-streaming response (no body)' });
					ctrl.close();
					return;
				}
				const reader = response.body.getReader();
				const dec = new TextDecoder();

				// Accumulate native tool call arguments per index
				const nativeToolCallBuf: Record<number, { id: string; name: string; argsBuf: string }> = {};
				let wasTruncated = false;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = dec.decode(value, { stream: true });

					for (const line of chunk.split('\n')) {
						const trimmed = line.trim();
						if (!trimmed.startsWith('data:')) continue;
						const data = trimmed.slice(5).trim();
						if (data === '[DONE]') continue;

						let parsed: unknown;
						try {
							parsed = JSON.parse(data);
						} catch {
							continue;
						}

						type DeltaChunk = {
							choices?: Array<{
								finish_reason?: string;
								delta?: {
									content?: string;
									tool_calls?: Array<{
										index: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
							}>;
						};
						const choice = (parsed as DeltaChunk)?.choices?.[0];
						if (!choice) continue;
						if (choice.finish_reason === 'length') wasTruncated = true;

						// ── Native tool calls (Ollama) ──────────────────────────────────
						if (useNativeTools && choice.delta?.tool_calls) {
							for (const tc of choice.delta.tool_calls) {
								const idx = tc.index ?? 0;
								if (!nativeToolCallBuf[idx]) {
									nativeToolCallBuf[idx] = {
										id: tc.id ?? '',
										name: tc.function?.name ?? '',
										argsBuf: ''
									};
								}
								if (tc.id) nativeToolCallBuf[idx].id = tc.id;
								if (tc.function?.name) nativeToolCallBuf[idx].name = tc.function.name;
								if (tc.function?.arguments) {
									nativeToolCallBuf[idx].argsBuf += tc.function.arguments;
									if (nativeToolCallBuf[idx].argsBuf.length > 50_000) {
										nativeToolCallBuf[idx].argsBuf = nativeToolCallBuf[idx].argsBuf.slice(
											0,
											50_000
										);
										send(ctrl, {
											type: 'error',
											error: `Tool call arguments for '${nativeToolCallBuf[idx].name}' exceeded 50 000 chars and were truncated — the tool call may fail.`
										});
									}
								}
							}
						}

						// ── Text content ─────────────────────────────────────────────
						const content = choice.delta?.content;
						if (typeof content === 'string' && content !== '') {
							if (useNativeTools) {
								// Buffer native text to extract <think>, <plan>, <done>, and raw JSON tool calls
								nativeTextBuf += content;
								nativeTextBuf = stripThinkBlocks(nativeTextBuf);
								nativeTextBuf = flushDoneBlocks(nativeTextBuf, (suggestions) => {
									send(ctrl, { type: 'suggestions', suggestions });
								});
								nativeTextBuf = flushBareSuggestionsJson(nativeTextBuf, (suggestions) => {
									send(ctrl, { type: 'suggestions', suggestions });
								});
								nativeTextBuf = flushPlanBlocks(nativeTextBuf, (rawJson) => {
									try {
										const plan = JSON.parse(rawJson) as {
											tables?: string[];
											cells?: string[];
											approach?: string;
										};
										send(ctrl, { type: 'plan_delta', plan });
									} catch {
										/* skip malformed plan */
									}
								});
								nativeTextBuf = flushPlanProposalBlocks(nativeTextBuf, (rawJson) => {
									try {
										const proposal = JSON.parse(rawJson);
										send(ctrl, { type: 'plan_proposal', proposal });
									} catch {
										/* skip malformed */
									}
								});
								nativeTextBuf = flushSprintBlocks(nativeTextBuf, (rawJson) => {
									try {
										const tasks = JSON.parse(rawJson);
										send(ctrl, { type: 'sprint_tasks', tasks });
									} catch {
										/* skip malformed */
									}
								});
								nativeTextBuf = flushSprintUpdateBlocks(nativeTextBuf, (rawJson) => {
									try {
										const tasks = JSON.parse(rawJson);
										send(ctrl, { type: 'sprint_update', tasks });
									} catch {
										/* skip malformed */
									}
								});
								// Extract any complete raw JSON tool calls mid-stream (models that
								// output {"tool":"...", "arguments":{...}} as text content)
								nativeTextBuf = extractRawJsonToolCalls(nativeTextBuf, (rawJson) => {
									emitToolCallGuarded(rawJson);
								});
								// stripOpenTag also holds back incomplete {"tool":...} at the tail
								const safeNative = stripOpenTag(nativeTextBuf);
								if (safeNative.length > 0) {
									sendTextDelta(ctrl, safeNative, () => {
										meaningfulTextEmitted = true;
									});
									nativeTextBuf = nativeTextBuf.slice(safeNative.length);
								}
							} else {
								buffer += content;
								// Extract complete <plan> blocks first
								buffer = flushPlanBlocks(buffer, (rawJson) => {
									try {
										const plan = JSON.parse(rawJson) as {
											tables?: string[];
											cells?: string[];
											approach?: string;
										};
										send(ctrl, { type: 'plan_delta', plan });
									} catch {
										/* skip malformed plan */
									}
								});
								buffer = flushPlanProposalBlocks(buffer, (rawJson) => {
									try {
										const proposal = JSON.parse(rawJson);
										send(ctrl, { type: 'plan_proposal', proposal });
									} catch {
										/* skip malformed */
									}
								});
								buffer = flushSprintBlocks(buffer, (rawJson) => {
									try {
										const tasks = JSON.parse(rawJson);
										send(ctrl, { type: 'sprint_tasks', tasks });
									} catch {
										/* skip malformed */
									}
								});
								buffer = flushSprintUpdateBlocks(buffer, (rawJson) => {
									try {
										const tasks = JSON.parse(rawJson);
										send(ctrl, { type: 'sprint_update', tasks });
									} catch {
										/* skip malformed */
									}
								});
								// Some models output bare plan JSON without <plan> tags — strip it.
								buffer = stripBarePlanJson(buffer, (plan) =>
									send(ctrl, { type: 'plan_delta', plan })
								);
								// Extract complete XML tool calls from buffer. Tool calls run BEFORE
								// done-blocks so that if the model emits <done> then run_cells in the
								// same chunk, stoppedForResultTool fires and the inner loop breaks
								// before the done-block is ever processed — preventing signalledDone=true
								// in the same turn as a result-critical tool.
								buffer = flushToolCalls(buffer, (rawJson) => {
									emitToolCallGuarded(rawJson);
									const parsedCall = parseToolCallObject(rawJson);
									if (parsedCall?.tool && STOP_AFTER_TOOLS.has(String(parsedCall.tool)))
										stoppedForResultTool = true;
								});
								// Also extract bare JSON tool calls (models that skip <tool_call> tags)
								buffer = extractRawJsonToolCalls(buffer, (rawJson) => {
									emitToolCallGuarded(rawJson);
									const parsedCall = parseToolCallObject(rawJson);
									if (parsedCall?.tool && STOP_AFTER_TOOLS.has(String(parsedCall.tool)))
										stoppedForResultTool = true;
								});
								// Extract <done> blocks (agent self-termination + suggestions) AFTER
								// tool calls so stoppedForResultTool can cut us off first.
								buffer = flushDoneBlocks(buffer, (suggestions) => {
									send(ctrl, { type: 'suggestions', suggestions });
								});
								buffer = flushBareSuggestionsJson(buffer, (suggestions) => {
									send(ctrl, { type: 'suggestions', suggestions });
								});
								// Flush text not part of a partial tool_call tag or plan tag
								const safeText = stripOpenTag(buffer);
								if (safeText.length > 0) {
									sendTextDelta(ctrl, safeText, () => {
										meaningfulTextEmitted = true;
									});
									buffer = buffer.slice(safeText.length);
								}
							}
						}
						// Stop reading if we just emitted a result-critical tool call — the client
						// will inject its result and start a new turn with real data.
						if (stoppedForResultTool) break;
					}
					if (stoppedForResultTool) {
						controller.abort();
						break;
					}
				}

				// Flush any remaining native text buffer
				if (useNativeTools && nativeTextBuf.trim()) {
					nativeTextBuf = stripThinkBlocks(nativeTextBuf);
					nativeTextBuf = flushDoneBlocks(nativeTextBuf, (suggestions) => {
						send(ctrl, { type: 'suggestions', suggestions });
					});
					nativeTextBuf = flushBareSuggestionsJson(nativeTextBuf, (suggestions) => {
						send(ctrl, { type: 'suggestions', suggestions });
					});
					nativeTextBuf = flushPlanBlocks(nativeTextBuf, (rawJson) => {
						try {
							const plan = JSON.parse(rawJson) as {
								tables?: string[];
								cells?: string[];
								approach?: string;
							};
							send(ctrl, { type: 'plan_delta', plan });
						} catch {
							/* skip */
						}
					});
					nativeTextBuf = flushPlanProposalBlocks(nativeTextBuf, (rawJson) => {
						try {
							const proposal = JSON.parse(rawJson);
							send(ctrl, { type: 'plan_proposal', proposal });
						} catch {
							/* skip malformed */
						}
					});
					nativeTextBuf = flushSprintBlocks(nativeTextBuf, (rawJson) => {
						try {
							const tasks = JSON.parse(rawJson);
							send(ctrl, { type: 'sprint_tasks', tasks });
						} catch {
							/* skip */
						}
					});
					nativeTextBuf = flushSprintUpdateBlocks(nativeTextBuf, (rawJson) => {
						try {
							const tasks = JSON.parse(rawJson);
							send(ctrl, { type: 'sprint_update', tasks });
						} catch {
							/* skip */
						}
					});
					// Fallback: some models emit XML <tool_call> blocks or raw JSON tool calls
					// as text content rather than using the native tool_calls delta format.
					nativeTextBuf = flushToolCalls(nativeTextBuf, (rawJson) => {
						emitToolCallGuarded(rawJson);
					});
					nativeTextBuf = extractRawJsonToolCalls(nativeTextBuf.trim(), (rawJson) => {
						emitToolCallGuarded(rawJson);
					});
					// Drop any unclosed <tool_call>/partial-JSON fragment left in the buffer —
					// there's no more stream coming to complete it, so emitting it raw would leak
					// literal tags (e.g. "<tool_call>") into the visible response.
					const finalNativeText = stripOpenTag(nativeTextBuf.trim()).trim();
					if (finalNativeText) {
						sendTextDelta(ctrl, finalNativeText, () => {
							meaningfulTextEmitted = true;
						});
					}
				}

				// Emit any accumulated native tool calls (gated by allowedTools + policy)
				let emittedNativeToolCalls = 0;
				for (const tc of Object.values(nativeToolCallBuf)) {
					if (!tc.name) continue;
					let args: Record<string, unknown> = {};
					const parsedArgs = parseToolCallObject(tc.argsBuf || '{}');
					if (parsedArgs) args = parsedArgs;
					if (emitPolicyToolCall(tc.name, args, tc.id || undefined)) {
						emittedNativeToolCalls++;
					}
				}

				if (pendingPolicyFallback && emittedNativeToolCalls === 0 && emittedXmlToolCalls === 0) {
					sendTextDelta(ctrl, pendingPolicyFallback, () => {
						meaningfulTextEmitted = true;
					});
				}

				// Hollow tool calls with no prose — answer schema-metadata questions from context.
				if (
					useNativeTools &&
					isSchemaListingQuestion &&
					!nativeTextBuf.trim() &&
					emittedNativeToolCalls === 0
				) {
					const mentioned = schema.filter((t) =>
						new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
							latestUserMessage
						)
					);
					const tablesToList = mentioned.length > 0 ? mentioned : schema.slice(0, 6);
					if (tablesToList.length > 0) {
						const lines = tablesToList.map((table) => {
							const typed = table.columns.map((c, i) => {
								const ty = table.columnTypes?.[i];
								return ty ? `\`${c}\` (${ty})` : `\`${c}\``;
							});
							return `**${table.name}**: ${typed.join(', ')}`;
						});
						sendTextDelta(ctrl, lines.join('\n'), () => {
							meaningfulTextEmitted = true;
						});
					}
				}

				// Debug subagent: surface cell error when model emits no prose.
				if (
					req.subagentType === 'debug' &&
					useNativeTools &&
					!nativeTextBuf.trim() &&
					!meaningfulTextEmitted
				) {
					const errCell = cells.find((c) => c.status === 'error' && c.errorMessage?.trim());
					if (errCell) {
						sendTextDelta(
							ctrl,
							`**${errCell.outputName}** fails: ${errCell.errorMessage} — check column names against the schema and patch only the broken references.`,
							() => {
								meaningfulTextEmitted = true;
							}
						);
					}
				}

				// Flush remaining XML buffer (skip if we stopped early for a result-critical tool call)
				if (!useNativeTools && buffer.trim() && !stoppedForResultTool) {
					buffer = flushDoneBlocks(buffer, (suggestions) => {
						send(ctrl, { type: 'suggestions', suggestions });
					});
					buffer = flushBareSuggestionsJson(buffer, (suggestions) => {
						send(ctrl, { type: 'suggestions', suggestions });
					});
					buffer = flushPlanBlocks(buffer, (rawJson) => {
						try {
							const plan = JSON.parse(rawJson) as {
								tables?: string[];
								cells?: string[];
								approach?: string;
							};
							send(ctrl, { type: 'plan_delta', plan });
						} catch {
							/* skip */
						}
					});
					buffer = flushPlanProposalBlocks(buffer, (rawJson) => {
						try {
							const proposal = JSON.parse(rawJson);
							send(ctrl, { type: 'plan_proposal', proposal });
						} catch {
							/* skip malformed */
						}
					});
					buffer = stripBarePlanJson(buffer, (plan) => send(ctrl, { type: 'plan_delta', plan }));
					buffer = flushToolCalls(buffer, (rawJson) => {
						emitToolCallGuarded(rawJson);
					});
					// Also extract bare JSON tool calls left in the buffer
					buffer = extractRawJsonToolCalls(buffer, (rawJson) => {
						emitToolCallGuarded(rawJson);
					});
					const finalText = stripOpenTag(buffer).trim();
					if (finalText) {
						sendTextDelta(ctrl, finalText, () => {
							meaningfulTextEmitted = true;
						});
					}
				}

				if (
					useNativeTools &&
					emittedNativeToolCalls === 0 &&
					emittedXmlToolCalls === 0 &&
					!meaningfulTextEmitted
				) {
					send(ctrl, {
						type: 'error',
						error:
							'Model returned an empty response. Try a shorter prompt or break the task into smaller steps.'
					});
				}

				if (wasTruncated && !stoppedForResultTool) send(ctrl, { type: 'truncated' });
				send(ctrl, { type: 'done' });
			} catch (err) {
				if (!(err instanceof Error && err.name === 'AbortError')) {
					send(ctrl, {
						type: 'error',
						error: err instanceof Error ? err.message : 'Internal error'
					});
				}
			} finally {
				ctrl.close();
			}
		},
		cancel() {
			controller.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
