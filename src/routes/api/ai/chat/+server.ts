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
import { READONLY_INVESTIGATION_TOOLS } from '$lib/server/ai-tools.js';

export type { AIChatRequest, AIChatToolCall, AIChatToolName, AIChatCell, AIChatSchemaTable };

function formatCellGraph(c: AIChatCell): string {
	const lang = c.cellType === 'python' ? 'python' : c.language;
	const parts: string[] = [`${c.outputName}(${lang},${c.status})`];
	if (c.upstream?.length) parts.push(`←[${c.upstream.join(',')}]`);
	if (c.downstream?.length) parts.push(`→[${c.downstream.join(',')}]`);
	if (c.criticalityScore && c.criticalityScore >= 3) {
		parts.push(`[HIGH IMPACT — ${c.criticalityScore} dependents]`);
	}
	if (c.errorMessage) parts.push(`[ERROR: ${c.errorMessage}]`);
	if (c.pythonError) parts.push(`[ERROR: ${c.pythonError}]`);
	return parts.join(' ');
}

function normalizeBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	// Only allow HTTPS endpoints or local development addresses (for Ollama etc.)
	if (
		!trimmed.startsWith('https://') &&
		!trimmed.startsWith('http://localhost') &&
		!trimmed.startsWith('http://127.0.0.1') &&
		!trimmed.startsWith('http://[::1]')
	) {
		throw new Error(`Invalid LLM base URL: must start with https:// or http://localhost`);
	}
	if (/\/v\d+$/i.test(trimmed)) return trimmed;
	return `${trimmed}/v1`;
}

/**
 * Compact, directive prompt for local Ollama models (qwen3, gemma, mistral).
 * Uses explicit <tool_call> tag syntax — smaller models follow explicit templates
 * far more reliably than open-ended native function calling.
 */
function isSmallModel(model: string): boolean {
	// Match standard sizes like :7b, :8b, :1.5b
	// Also match quantization-prefixed sizes like :e4b (gemma4:e4b = 8B/Q4), :q4b, :w4b
	const m = model.match(/:[a-z]*(\d+(?:\.\d+)?)b/i);
	return m !== null && parseFloat(m[1]) <= 8;
}

function extractTableRefs(code: string): Set<string> {
	const refs = new Set<string>();
	for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+([\w."]+)/gi)) {
		refs.add(m[1].replace(/"/g, '').toLowerCase());
	}
	return refs;
}

function prioritizeSchema(
	schema: AIChatSchemaTable[],
	cells: AIChatCell[],
	maxTables: number,
	maxCols: number
): AIChatSchemaTable[] {
	const activeTables = new Set<string>();
	for (const c of cells) {
		for (const ref of extractTableRefs(c.code)) activeTables.add(ref);
	}
	return [...schema]
		.sort((a, b) => {
			const aHit = activeTables.has(a.name.toLowerCase()) ? 1 : 0;
			const bHit = activeTables.has(b.name.toLowerCase()) ? 1 : 0;
			return bHit - aHit;
		})
		.slice(0, maxTables)
		.map((t) => ({
			...t,
			columns: t.columns.slice(0, maxCols),
			columnTypes: t.columnTypes?.slice(0, maxCols)
		}));
}

function buildDialectSection(dialect: string): string {
	if (dialect === 'trino') {
		return `\n\n## SQL Dialect: Trino
- Random sample: ORDER BY rand() LIMIT n  (no USING SAMPLE)
- Dates: DATE_TRUNC('month', col), DATE_ADD('day', n, col), DATE_DIFF('day', a, b)
- Approx: approx_distinct(col), approx_percentile(col, 0.95)
- Arrays: CROSS JOIN UNNEST(arr) AS t(val), array_agg(), array_join(arr, ',')
- Strings: split(col, ','), regexp_extract(col, pattern, group)
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

	// Prioritize schema tables referenced by active cells; truncate more aggressively for small models
	const prioritizedSchema = prioritizeSchema(schema, cells, isSmall ? 10 : 20, isSmall ? 8 : 15);
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
SQL cell:        <tool_call>{"tool":"create_cell","callId":"C1","args":{"outputName":"cell_name","cellType":"query","code":"SELECT ...","materializeMode":"table"}}</tool_call>
Markdown cell:   <tool_call>{"tool":"create_cell","callId":"C2","args":{"outputName":"intro","cellType":"markdown","markdown":"## Title\\n\\nText."}}</tool_call>
Update cell:     <tool_call>{"tool":"update_cell","callId":"C3","args":{"cellId":"EXISTING_ID","code":"SELECT ..."}}</tool_call>
Move cell:       <tool_call>{"tool":"move_cell","callId":"C4","args":{"cellId":"EXISTING_ID","direction":"up"}}</tool_call>
Auto chart:      <tool_call>{"tool":"pick_chart","callId":"C5","args":{"cellId":"C1"}}</tool_call>
Custom chart:    <tool_call>{"tool":"set_chart","callId":"C6","args":{"cellId":"C1","chartConfig":{"chartType":"area","xColumn":"month","yColumns":["revenue"],"title":"Revenue Over Time"}}}</tool_call>
Run cells:       <tool_call>{"tool":"run_cells","callId":"C7","args":{"cellIds":["C1","C2","C3"]}}</tool_call>
Query data:      <tool_call>{"tool":"query_data","callId":"D1","args":{"sql":"SELECT DISTINCT status FROM orders LIMIT 10"}}</tool_call>
Sample table:    <tool_call>{"tool":"sample_data","callId":"D2","args":{"table":"orders","n":5}}</tool_call>
Profile col:     <tool_call>{"tool":"profile_column","callId":"D3","args":{"table":"orders","column":"status"}}</tool_call>
Get cell result: <tool_call>{"tool":"get_cell_result","callId":"D4","args":{"cellId":"C1","limit":20}}</tool_call>
List cells:      <tool_call>{"tool":"list_cells","callId":"L1","args":{}}</tool_call>
Search:          <tool_call>{"tool":"search_workspace","callId":"S1","args":{"query":"customer dim"}}</tool_call>
Record decision: <tool_call>{"tool":"record_decision","callId":"R1","args":{"decision":"treating email as FK to customers — no id in source"}}</tool_call>
`;

	// Small models (≤8B): compact prompt — one-shot format example first, 6 critical rules, trimmed context
	if (isSmall) {
		const smallPlanNote =
			sessionPlanContext && sessionPlanContext.length > 0
				? '\nDecisions: ' + sessionPlanContext.slice(-3).join('; ')
				: '';
		return `TOOL FORMAT — use exactly:
<tool_call>{"tool":"create_cell","callId":"C1","args":{"outputName":"sales_by_month","cellType":"query","code":"SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 1"}}</tool_call>
<tool_call>{"tool":"run_cells","callId":"R1","args":{"cellIds":["C1"]}}</tool_call>
<tool_call>{"tool":"pick_chart","callId":"P1","args":{"cellId":"C1"}}</tool_call>
<tool_call>{"tool":"update_cell","callId":"U1","args":{"cellId":"C1","code":"SELECT ..."}}</tool_call>
<tool_call>{"tool":"sample_data","callId":"D1","args":{"table":"orders","n":5}}</tool_call>
<tool_call>{"tool":"query_data","callId":"D2","args":{"sql":"SELECT DISTINCT status FROM orders LIMIT 5"}}</tool_call>

You are an analytics engineer building SQL notebooks.

RULES:
1. ONLY use column names listed in Schema — never invent names.
2. NEVER write WITH (...) CTEs — write SELECT FROM tablename directly.
3. NEVER end SQL with semicolon (;).
4. ALL SQL goes inside tool_call args — never in prose.
5. After run_cells: if a cell failed, fix with update_cell then run_cells again.
6. End with <done>{"suggestions":["short 1","short 2","short 3"]}</done> — but NEVER in the same response as run_cells or sample_data (you will receive their results first).

Other tools: list_cells{}, search_workspace{query}, create_cell markdown: {outputName,cellType:"markdown",markdown:"# Title\\nText"}
${contractNote}${buildDialectSection(connectionDialect)}${pythonAvailable ? '' : '\nNo Python cells available — SQL only.'}

Cells: ${cellList}
Schema:
  ${schemaList}${schemaChangeNote2}${smallPlanNote}`;
	}

	// Larger Ollama models: full prompt with format examples moved to front for stronger attention
	return `${formatSection}
You are a senior analytics engineer responsible for designing maintainable, reusable analytical data models. Build professional notebooks using tool calls.

RULES:
1. DISCOVER FIRST (for new models): Call list_cells and search_workspace before creating any new SQL cell. State what you found. DUPLICATION IS A MODELING ERROR — check before you build.
2. INVESTIGATE DATA: Call sample_data on unfamiliar tables before writing SQL. Skip if session data context already shows the table.
3. SCHEMA IS LAW: ONLY use column names listed in the Schema section. Column names shown as "name" (with double-quotes) contain spaces — you MUST write them as "name" in SQL.
4. MARKDOWN CELLS: use cellType:"markdown" and the markdown field. NEVER put headings or prose in the code field.
5. NEVER end SQL with a semicolon (;). Trailing semicolons break CTE chaining.
6. NEVER write WITH clauses — each cell's outputName is auto-wrapped as a CTE.
7. MATERIALIZATION: set materializeMode on new model cells (table/view/incremental/ephemeral) per workspace conventions.
8. CHARTS — always call pick_chart after run_cells; it auto-selects the best chart type and falls back to table view for results with no numeric columns. Use set_chart only for specific non-default types (area for cumulative, pie, scatter).
9. NEVER write SQL in prose or markdown code blocks. ALL SQL goes inside tool_call args.
10. Modify existing cells with update_cell. Call run_cells after updates.
11. Use window functions (LAG, RANK, SUM OVER, ROW_NUMBER) for growth rates, rankings, running totals.
12. Start with a markdown intro cell, then SQL cells, then run_cells, then pick_chart.
13. SELF-CORRECT: After run_cells, if ANY cell failed, fix it with update_cell and retry. Do NOT output <done> until all succeed.
14. DONE: <done>{"suggestions":["short follow-up 1","short follow-up 2","short follow-up 3"]}</done>. Keep each suggestion under 60 chars. Never include <done> in a response that also calls run_cells, sample_data, query_data, or profile_column — the system pauses after those and gives you results first.
15. MODELING LAYERS: stg_ = staging — REQUIRED: cast types, coalesce NULLs, deduplicate, AND extract features (date parts like day_of_week/month/quarter, text splits like email_domain, CASE tier buckets like price_tier/churn_risk) so fct_/mart_ never re-derive them. dim_ = entity tables (one row per entity). fct_ = fact events (one row per event, must have timestamp + FK to dims). mart_ = reporting (SELECT only from fct_/dim_, no raw tables). State grain (1 row = 1 what?) before writing any cell.
16. DOCUMENT YOUR WORK: after cells run clean, always write a markdown findings cell (cellType:"markdown", outputName:"findings") summarising what was built, data quality notes, and key decisions.
17. LIVE REFS IN MARKDOWN: ${buildMarkdocSyntaxBlock()}
17. RECORD DECISIONS: after confirming a primary key, join key, grain, or business rule, call record_decision. Re-injected in all future turns — you will never need to re-investigate it.

You MAY write 1–2 sentences of explanation before tool calls.

Notebook cells: ${cellList}
Schema:
  ${schemaList}${memNote}${dataNote}${planNote}${schemaChangeNote2}${contractNote}${buildDialectSection(connectionDialect)}${buildToolSelectionSection(pythonAvailable)}`;
}

function buildToolSelectionSection(pythonAvailable: boolean): string {
	if (pythonAvailable) {
		return `\n\n## Tool selection\nUse SQL for relational transforms (joins, filters, aggregations, window functions). Use create_cell with cellType:"python" for statistics, ML, text/regex processing, or custom visualization beyond what set_chart/pick_chart support. When a different cell type would serve the request better than an existing cell, create a new cell (afterCellId set to the current one) rather than forcing a mismatched language via update_cell — leave the original cell unchanged.`;
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
						return `  id=${c.id} name="${c.outputName}" status=${c.status}${lang}${active}${impact}${up}${down}${chart}${err}`;
					})
					.join('\n')
			: '  (none)';

	const schemaList =
		schema.length > 0
			? schema
					.slice(0, 30)
					.map((t) => {
						const colList = t.columns
							.slice(0, 15)
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
	// #3 — Modeling decisions recorded via record_decision this session
	const planSection =
		sessionPlanContext && sessionPlanContext.length > 0
			? '\n\n## Established modeling decisions (do not re-investigate)\n' +
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

IMPORTANT: callId is how you reference cells later. Use a cell's callId as the cellId argument in pick_chart, set_chart, and run_cells.
`;

	return `You are a senior analytics engineer in Lunapad. Before writing any SQL, identify the **business question** behind the request — not just the technical task. Build what was asked AND the obvious next level: if asked for revenue, also design the customer grain; if the data is sessions, also think about the conversion funnel. Your primary obligation is to the long-term health of the model graph. Your output must read like a real analyst's deliverable — structured, insight-driven, reusable.
${toolFmtSection}

## Modeling Workflow (required when creating any new model)

**Step 0 — Investigate source data** (if working with raw tables you haven't seen)
Call \`sample_data\` to learn actual values, date formats, and nulls before writing SQL.

**Step 1 — Discover** (mandatory before any \`create_cell\` for a new model)
Call \`list_cells\` to survey the full model landscape.
Call \`search_workspace("{intent}")\` to find similar or related models — it returns full SQL for matched cells.
State explicitly what you found before proceeding:
  > "Found reusable: \`dim_customer\`, \`fct_orders\` — will build on these."
  > "Found nothing relevant — creating from scratch."
⚠ **DUPLICATION IS A MODELING ERROR**: creating a cell whose logic duplicates an existing model (rather than extending it) is an error, not a style preference. Always check before you build.

**Step 2 — Plan** (emit before any \`create_cell\` calls)
<plan>
Grain: one row = one [entity/event/metric period]
Reusing: [existing cell names, or "none found"]
Creating: [new_model_name] as [stg_/dim_/fct_/metric_]
Materialization: [table|view|incremental|ephemeral] — [reasoning]
Dependencies: [new_model] ← [upstream cells]
</plan>

**Step 3 — Build** (dependency order: upstream cells first)
Reference existing cells by outputName — they auto-wrap as CTEs.
Set \`materializeMode\` on new cells per workspace conventions.

**Step 4 — Validate**: run_cells, self-correct any errors.

**Step 5 — Document** (required after cells run clean)
Write a markdown cell (\`cellType: "markdown"\`, \`outputName: "findings"\` or \`"summary"\`) leading with **findings** — what the data actually reveals, not just what was built. Format: "**Finding**: 23% of orders have null customer_id — likely guest checkout." Then cover: grain of each model, key decisions (layer, materialization, join logic, dedup), data quality observations (NULLs, duplicates, unexpected values, date range). An analyst reading this notebook should immediately understand what the data *means*, not just what was built.

${buildMarkdocSyntaxBlock()}

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
- create_cell: {outputName:string, code:string, language:"sql", cellType?:"query"|"markdown"${pythonAvailable ? '|"python"' : ''}, markdown?:string, materializeMode?:"ephemeral"|"view"|"table"|"incremental"}
  - For markdown cells use short descriptive outputNames: intro, overview, summary, insights, methodology, findings
  - For SQL cells use snake_case names describing the query: revenue_by_month, top_customers, order_funnel${pythonAvailable ? '\n  - For Python cells (cellType:"python") omit language — write Python source directly in code. See Tool selection below for when to use Python over SQL.' : ''}
  - Set materializeMode per workspace conventions (or omit for ephemeral/ad-hoc)
  - ⚠ NEVER put SQL code blocks inside a markdown cell's content — the \`markdown\` field must contain prose only. SQL belongs exclusively in the \`code\` field of query (cellType:"query") cells.
- **pick_chart: {cellId:string}** — PREFERRED. Call after run_cells. Reads actual result and auto-selects the correct chart type. Use this for every query cell.
- set_chart: {cellId:string, chartConfig:{chartType:"bar"|"bar-horizontal"|"line"|"area"|"scatter"|"bubble"|"pie"|"histogram"|"heatmap"|"big-value"|"value"|"delta"|"funnel"|"box-plot"|"calendar-heatmap"|"sankey", xColumn:string, yColumns:string[], colorColumn?:string, seriesMode?:"auto"|"grouped"|"stacked", sortOrder?:"none"|"asc"|"desc", title?:string}}
  - Use only when you need a specific non-default type: area for cumulative totals, pie for proportions, scatter with colorColumn, sankey, etc.
- run_cells: {cellIds:string[]} — always run all created query cells
- update_cell: {cellId:string, code?:string, outputName?:string}
- delete_cell: {cellId:string}
- move_cell: {cellId:string, direction?:"up"|"down", toIndex?:number} — reorder a cell in the notebook

## Tools (data investigation — call BEFORE writing SQL)
- sample_data: {table:string, n?:number} — random rows from a schema table. **Call this first on any unfamiliar table** to learn actual values, date formats, and column content.
- query_data: {sql:string, limit?:number} — run any read-only SELECT to verify specific values, ranges, or join keys
- profile_column: {table:string, column:string} — null rate, distinct count, min/max, top 5 values; use before GROUP BY or JOIN on unknown columns

**DATA RULE: The schema shows column names only — not values. If you don't know what's in a column (status codes, category names, date format, nullable), call sample_data or query_data FIRST. Never invent values.**

**SELF-CORRECT: After run_cells you will receive each cell's result (row count or error). If ANY cell failed, you MUST fix it: call update_cell with corrected SQL, then run_cells again. Keep trying with a different approach if the same fix fails. Do NOT output \`<done>\` until ALL cells succeed.**

**DONE SIGNAL: When your analysis is fully complete, output a \`<done>\` block at the very end (after all tool calls and prose): \`<done>{"suggestions":["short follow-up 1","short follow-up 2","short follow-up 3"]}</done>\`. Each suggestion must name a specific analytical pattern, metric, or model the data can support next — not a generic task. Good: \`"Retention curve by signup_month"\`, \`"RFM segmentation on these orders"\`. Bad: \`"Add more metrics"\`, \`"Improve the model"\`. Then stop calling tools. After each \`run_cells\`, \`sample_data\`, \`query_data\`, or \`profile_column\` call, the system pauses and gives you the result before you continue — do NOT include \`<done>\` in the same response as these tools.**

## Tools (lookup — use before building or modifying cells)
- get_lineage: {outputName:string} — upstream/downstream deps
- list_cells: {} — full inventory of existing models (use in Step 1)
- search_workspace: {query:string} — semantic search; returns full SQL code for matched cells (use in Step 1 to find reusable models)
- get_cell_result: {cellId:string, limit?:number} — read an already-run cell's result data without re-querying. Use when explaining results or charting existing data.
- **record_decision: {decision:string}** — record a modeling decision that persists across turns. Call after confirming a primary key, join key, grain, business rule, or data quality fix. Prevents re-investigating already-resolved questions in later turns.

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
	isSmall: boolean
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

	const schemaList =
		schema
			.slice(0, 20)
			.map((t) => {
				const cols = t.columns
					.slice(0, 15)
					.map((col) => (col.includes(' ') ? `"${col}"` : col))
					.join(', ');
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
						isSmall
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
						true
					);
			const skipNote =
				"\n\n> **Note**: Workspace discovery was already completed — skip Step 1 (Discover). Proceed directly to Step 2 (Plan) then Step 3 (Build). Your ONLY job here is to write and validate SQL models. Do NOT describe or plan dashboard creation — dashboard assembly is handled separately after your SQL work is complete. After cells run clean (Step 4 — Validate), write a findings markdown cell (Step 5 — Document) before calling <done>.\n\n> **CRITICAL — source data rule**: The Schema section lists raw source tables including uploaded files (names often contain timestamps like `table_2026_06_15...`). NEVER reference these raw table names directly in SQL. Always reference them through an existing notebook cell by its outputName (e.g. `FROM new_model_3`) — the cell auto-wraps as a CTE. Writing `FROM de__table_2026...` will fail at runtime because the timestamp changes. If the discovery result identified an existing cell that reads the source, use that cell's outputName as your upstream reference.\n";
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
- update_cell: {"cellId": "...", "code": "..."}
- run_cells: {"cellIds": ["..."]}
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
   — UNKNOWN: call run_cells to capture the full error, then sample_data or query_data to diagnose.
3. Fix the SQL with update_cell (patch only what is broken).
4. Call run_cells again to verify the fix succeeded.
5. Call validate_result to confirm the cell produces output.
6. Call <done> when the cell runs successfully.

Do NOT create new cells. Do NOT delete cells. Only patch and verify.

<done>{"suggestions":["What the fix was and why"]}</done>

Notebook:
${debugCellList}${planNote}${contractNote}${dialectNote}${dataNote}

Schema:
${schemaList}`;
		}

		case 'dashboard':
			return `You are a visual summary builder. Your job is to compose a single Markdoc markdown cell that lays out existing query cells as a grid of KPI/chart widgets — there is no separate "dashboard" object anymore, just a richly-templated markdown cell.

${toolFmt}
Available tools:
- list_cells: {}
- get_cell_result: {"cellId": "...", "limit": 5}
- get_lineage: {"outputName": "..."}
- pick_chart: {"cellId": "..."}
- set_chart: {"cellId": "...", "chartConfig": {...}}
- create_cell: {"outputName": "overview", "cellType": "markdown", "markdown": "..."}
- update_cell: {"cellId": "...", "markdown": "..."}

${buildMarkdocSyntaxBlock()}

Workflow:
1. Call list_cells. Identify cells by dbt layer and prioritise for the summary:
   - mart_ cells are designed for reporting — prefer these above all others.
   - fct_ and dim_ cells are acceptable when no mart_ exists for the topic.
   - Do NOT include stg_ or ephemeral intermediate cells — they are not reporting-ready.
   If the topic has no mart_ or fct_ cells, include a suggestion in <done> that a mart model should be created first.
2. For each selected cell, call get_cell_result to understand its shape (columns, row count).
3. Write ONE markdown cell (cellType: "markdown") using {% grid cols=N %} of {% metric %} widgets for top-line KPIs and {% chart %} tags for trends — reference cells via $outputName, never hardcoded values (numbers, dates, or text).
4. Use {% columns %}/{% column %} to lay out multiple charts side by side when there are several cells to cover.
5. Call <done>.

Do NOT write SQL or create query cells — only compose the summary cell from existing ones.

<done>{"suggestions":["Follow-up ideas for the summary"]}</done>

Notebook:
${cellList}${contractNote}`;

		case 'documentation':
			return `You are a documentation agent. Your only job is to read existing cell results and write ONE well-structured Markdoc markdown cell summarizing them. Do NOT write or modify SQL, and do NOT create or edit query cells.

${toolFmt}
Available tools:
- list_cells: {}
- get_cell_result: {"cellId": "...", "limit": 50}
- create_cell: {"outputName": "findings", "cellType": "markdown", "markdown": "..."}
- update_cell: {"cellId": "...", "markdown": "..."}
- record_decision: {"decision": "..."}

${buildMarkdocSyntaxBlock()}

Workflow:
1. Call list_cells, then get_cell_result on the cells relevant to this task to see actual values, row counts, and column names.
2. Write one markdown cell (cellType: "markdown") leading with the finding, not just a description of what was built.
3. Use {% grid %} of {% metric %} widgets for top-line KPIs, {% chart %} for trends, {% callout type="warning" %} to flag data-quality issues (nulls, duplicates, unexpected values), and {% if gt($cell.count, 0) %}...{% else /%}...{% /if %} to handle empty-result states gracefully.
4. Never hard-code a value — number, date, or text — that comes from a query result; every such value must be a live ref.
5. Call <done>.

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
   - "document": write a findings markdown cell
   - "dashboard": compose a Markdoc grid/columns layout of metric and chart widgets in one markdown cell, from existing cells
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

// Native OpenAI-format tool definitions (kept minimal to reduce token count)
// Lookup tools run client-side; they inject results as text into the message thread.
const NATIVE_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'create_cell',
			description:
				'MANDATORY: Use this for every SQL query and every markdown block. Never write SQL in text. For SQL cells: cellType="query", complete SQL in "code". For prose/explanation: cellType="markdown", GitHub-flavored markdown in "markdown" (# headers, **bold**, bullet lists). For statistics/ML/text-processing/custom viz (only when Python is available — see Tool selection): cellType="python", Python source in "code", omit "language". Markdown outputNames: intro, overview, summary, insights, methodology, findings. SQL/Python outputNames: revenue_by_month, top_customers, order_funnel (snake_case).',
			parameters: {
				type: 'object',
				properties: {
					outputName: {
						type: 'string',
						description:
							'For markdown: short word (intro, summary, findings). For SQL/Python: snake_case description (revenue_by_month, top_customers).'
					},
					cellType: {
						type: 'string',
						enum: ['query', 'markdown', 'python'],
						description:
							'query for SQL, markdown for explanatory prose, python for stats/ML/text-processing (only if Python is available in this environment — see Tool selection section)'
					},
					code: {
						type: 'string',
						description:
							'Complete SQL or Python source for query/python cells. Omit for markdown cells.'
					},
					markdown: {
						type: 'string',
						description:
							'GFM markdown content for markdown cells. Use headers (# ## ###), **bold**, bullet lists, `code` spans. Embed live query refs with $outputName.field (e.g. $orders.count, $top_month.revenue) for simple values, or use Markdoc tags for KPI cards/charts/layout: {% metric value=$orders.revenue label="Revenue" vs=$prev.revenue /%}, {% chart type="bar" data=$orders.rows x="month" y="revenue" /%}, {% grid cols=3 %}...{% /grid %}, {% callout type="warning" %}...{% /callout %}. Values update automatically when cells re-run.'
					},
					language: { type: 'string', enum: ['sql'], description: 'Always "sql" for query cells.' },
					materializeMode: {
						type: 'string',
						enum: ['ephemeral', 'view', 'table', 'incremental'],
						description:
							'How to materialize this model. Set per workspace naming conventions: dim_→table, fct_→incremental, stg_→view, metric_→incremental. Omit for ephemeral ad-hoc queries.'
					}
				},
				required: ['outputName', 'cellType']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'pick_chart',
			description:
				'PREFERRED chart tool. Call after run_cells — reads actual result rows/columns and selects the best chart type, or falls back to table view when no numeric data is present. Always call pick_chart after run_cells; only fall back to set_chart when you need a specific type (e.g. area for cumulative, pie for proportions, scatter).',
			parameters: {
				type: 'object',
				properties: {
					cellId: {
						type: 'string',
						description:
							'The cell to chart. Use the same callId or outputName you used in run_cells.'
					}
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'set_chart',
			description:
				'Explicitly configure a chart when you need a specific type that pick_chart would not choose (e.g. area for cumulative revenue, pie for proportions, scatter with colorColumn). For all other cases, prefer pick_chart after run_cells. Use chartType "custom" with a `code` snippet for chart shapes none of the other types can express — code receives `rows`, `columns` and should return a Plotly figure object: `{ data: [...], layout: {...} }`; xColumn/yColumns can be left empty for "custom".',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string' },
					chartConfig: {
						type: 'object',
						properties: {
							chartType: {
								type: 'string',
								enum: [
									'bar',
									'bar-horizontal',
									'line',
									'area',
									'scatter',
									'bubble',
									'pie',
									'histogram',
									'heatmap',
									'big-value',
									'value',
									'delta',
									'funnel',
									'box-plot',
									'calendar-heatmap',
									'sankey',
									'custom'
								]
							},
							xColumn: {
								type: 'string',
								description: 'Dimension / date / category / value column'
							},
							yColumns: {
								type: 'array',
								items: { type: 'string' },
								description:
									'One or more measure columns. List all numeric measures for grouped/stacked charts.'
							},
							colorColumn: {
								type: 'string',
								description: 'Optional: split series by this column (grouped bars, scatter color)'
							},
							seriesMode: {
								type: 'string',
								enum: ['auto', 'grouped', 'stacked'],
								description: 'Use grouped or stacked when yColumns has multiple entries'
							},
							sortOrder: { type: 'string', enum: ['none', 'asc', 'desc'] },
							title: { type: 'string' },
							code: {
								type: 'string',
								description:
									'Required when chartType is "custom": a JS Plotly figure spec, see description above.'
							}
						},
						required: ['chartType', 'xColumn', 'yColumns']
					}
				},
				required: ['cellId', 'chartConfig']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_cells',
			description: 'Execute cells. Call after creating/updating query cells.',
			parameters: {
				type: 'object',
				properties: {
					cellIds: { type: 'array', items: { type: 'string' } }
				},
				required: ['cellIds']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'update_cell',
			description: 'Edit SQL code of an existing cell.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string' },
					code: { type: 'string' }
				},
				required: ['cellId']
			}
		}
	},
	...READONLY_INVESTIGATION_TOOLS,
	{
		type: 'function',
		function: {
			name: 'list_cells',
			description:
				'Lists all query cells with status and row counts. Use when you need a full inventory of existing cells.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'query_data',
			description:
				'Run a read-only SELECT against the active database. Use BEFORE writing SQL to verify column values, date formats, join keys, and value ranges. Never invent values — inspect them first.',
			parameters: {
				type: 'object',
				properties: {
					sql: {
						type: 'string',
						description: 'A read-only SELECT statement. No WITH clauses needed.'
					},
					limit: { type: 'number', description: 'Max rows to return (default 20, max 50).' }
				},
				required: ['sql']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'move_cell',
			description: 'Reorder a cell within the notebook.',
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell id or outputName to move.' },
					direction: {
						type: 'string',
						enum: ['up', 'down'],
						description: 'Move one step up or down.'
					},
					toIndex: { type: 'number', description: 'Move to exact 0-based index position.' }
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'record_decision',
			description:
				'Record a modeling decision that should persist across turns. Call when you resolve something non-obvious: confirmed primary key, join key, grain choice, data quality issue fixed, business rule applied. These are re-injected in every subsequent turn so you never re-investigate a resolved question.',
			parameters: {
				type: 'object',
				properties: {
					decision: {
						type: 'string',
						description:
							'Concise statement of what was decided and why (e.g. "treating email as FK to customers — id not present in source").'
					}
				},
				required: ['decision']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'validate_result',
			description:
				"Assert that a cell's result meets expectations. Use after run_cells to verify correctness. Returns PASS or a list of FAIL messages.",
			parameters: {
				type: 'object',
				properties: {
					cellId: { type: 'string', description: 'Cell outputName or id to validate.' },
					assertNotEmpty: { type: 'boolean', description: 'Fail if result has 0 rows.' },
					expectedRowCount: { type: 'number', description: 'Exact expected row count.' },
					minRowCount: { type: 'number', description: 'Minimum acceptable row count.' },
					expectedColumns: {
						type: 'array',
						items: { type: 'string' },
						description: 'Column names that must be present in the result.'
					}
				},
				required: ['cellId']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'compare_cells',
			description:
				'Compare the row counts and column schemas of two cells. Useful for verifying a refactored cell produces the same output as the original.',
			parameters: {
				type: 'object',
				properties: {
					cellId1: { type: 'string', description: 'First cell outputName or id.' },
					cellId2: { type: 'string', description: 'Second cell outputName or id.' }
				},
				required: ['cellId1', 'cellId2']
			}
		}
	}
];

function buildUserContent(
	cells: AIChatCell[],
	messages: Array<{ role: string; content: string }>
): string {
	// Attach full code for cells referenced in recent user messages
	const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
	const referencedOutputNames = new Set(
		cells.filter((c) => lastUserMsg.includes(c.outputName)).map((c) => c.outputName)
	);
	// Also always include full code for error cells — LLM needs it to write a fix
	// even when the user says "fix it" without naming the specific cell
	const errorCells = cells.filter((c) => c.status === 'error' && c.code.trim());
	for (const c of errorCells) referencedOutputNames.add(c.outputName);

	const codeBlocks = cells
		.filter((c) => referencedOutputNames.has(c.outputName) && c.code.trim())
		.map((c) => {
			const errNote = c.status === 'error' && c.errorMessage ? `\n-- Error: ${c.errorMessage}` : '';
			return `### Cell: ${c.outputName} (${c.language})${errNote ? '\n' + errNote : ''}\n\`\`\`sql\n${c.code}\n\`\`\``;
		})
		.join('\n\n');

	return codeBlocks ? `${lastUserMsg}\n\n${codeBlocks}` : lastUserMsg;
}

interface SSEController {
	enqueue: (data: string) => void;
	close: () => void;
}

function send(sc: SSEController, event: Record<string, unknown>): void {
	try {
		sc.enqueue(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		// stream closed
	}
}

/**
 * Parse a raw tool-call payload (either the inside of a <tool_call> tag or a bare
 * {"tool":...} JSON object) and emit a tool_call SSE event. Centralises the parse +
 * normalise + allowedTools-gate logic that was duplicated across every streaming and
 * final-flush site, so the lenient parser applies uniformly. Returns true if a tool
 * call was emitted.
 */
function emitToolCall(
	ctrl: SSEController,
	raw: string,
	allowedTools: AIChatToolName[] | undefined,
	nextCallId: () => string
): boolean {
	const call = parseToolCallObject(raw);
	if (!call || typeof call.tool !== 'string') return false;
	const toolCall: AIChatToolCall = {
		callId: typeof call.callId === 'string' ? call.callId : nextCallId(),
		tool: call.tool as AIChatToolName,
		args: normalizeToolCallArgs(call) as unknown as AIChatToolCall['args']
	};
	if (allowedTools && !allowedTools.includes(toolCall.tool)) return false;
	send(ctrl, { type: 'tool_call', call: toolCall });
	return true;
}

/** Extract complete <done>...</done> blocks from buffer, emit suggestions events. */
function flushDoneBlocks(buffer: string, onDone: (suggestions: string[]) => void): string {
	const OPEN = '<done>';
	const CLOSE = '</done>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		try {
			const payload = JSON.parse(raw) as { suggestions?: string[] };
			if (Array.isArray(payload.suggestions)) onDone(payload.suggestions);
		} catch {
			/* skip malformed */
		}
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/**
 * Extract complete bare {"suggestions":[...]} JSON objects from buffer.
 * Fallback for models (typically cloud/native-tool) that output suggestions JSON
 * without <done> tags. Applied after flushDoneBlocks so proper <done> blocks win.
 */
function flushBareSuggestionsJson(
	buffer: string,
	onSuggestions: (suggestions: string[]) => void
): string {
	const re = /\{"suggestions"\s*:/g;
	let match: RegExpExecArray | null;
	const ranges: [number, number][] = [];

	while ((match = re.exec(buffer)) !== null) {
		const start = match.index;
		let depth = 0;
		let end = -1;
		for (let i = start; i < buffer.length; i++) {
			if (buffer[i] === '{') depth++;
			else if (buffer[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i + 1;
					break;
				}
			}
		}
		if (end === -1) continue; // incomplete — skip, stripOpenTag holds it back
		const raw = buffer.slice(start, end);
		try {
			const payload = JSON.parse(raw) as { suggestions?: string[] };
			if (Array.isArray(payload.suggestions)) {
				onSuggestions(payload.suggestions);
				ranges.push([start, end]);
			}
		} catch {
			/* skip malformed */
		}
	}

	// Remove matched ranges in reverse so slice indices stay valid
	let result = buffer;
	for (let i = ranges.length - 1; i >= 0; i--) {
		const [start, end] = ranges[i];
		result = result.slice(0, start) + result.slice(end);
	}
	return result;
}

/**
 * Extract complete <plan_proposal>...</plan_proposal> blocks from buffer.
 * The modeling subagent emits one of these at the end of Phase 2 so the client
 * can surface a "here's what I'll build — approve?" card before sql-gen starts.
 */
function flushPlanProposalBlocks(buffer: string, onProposal: (raw: string) => void): string {
	const OPEN = '<plan_proposal>';
	const CLOSE = '</plan_proposal>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onProposal(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <sprint>[...]</sprint> blocks from buffer, emit sprint_tasks events. */
function flushSprintBlocks(buffer: string, onSprint: (raw: string) => void): string {
	const OPEN = '<sprint>';
	const CLOSE = '</sprint>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onSprint(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <sprint_update>[...]</sprint_update> blocks from buffer. */
function flushSprintUpdateBlocks(buffer: string, onUpdate: (raw: string) => void): string {
	const OPEN = '<sprint_update>';
	const CLOSE = '</sprint_update>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onUpdate(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <plan>...</plan> blocks from buffer, emit plan_delta events. */
function flushPlanBlocks(buffer: string, onPlan: (raw: string) => void): string {
	const OPEN = '<plan>';
	const CLOSE = '</plan>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(CLOSE, start + OPEN.length);
		if (end === -1) break;
		const raw = remaining.slice(start + OPEN.length, end).trim();
		onPlan(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + CLOSE.length);
		searchFrom = start;
	}
	return remaining;
}

/** Extract complete <tool_call>...</tool_call> blocks from buffer, emit events for each. */
function flushToolCalls(buffer: string, onToolCall: (raw: string) => void): string {
	const TAG_OPEN = '<tool_call>';
	const TAG_CLOSE = '</tool_call>';
	let remaining = buffer;
	let searchFrom = 0;

	while (true) {
		const start = remaining.indexOf(TAG_OPEN, searchFrom);
		if (start === -1) break;
		const end = remaining.indexOf(TAG_CLOSE, start + TAG_OPEN.length);
		if (end === -1) break; // incomplete — keep in buffer

		const raw = remaining.slice(start + TAG_OPEN.length, end).trim();
		onToolCall(raw);
		remaining = remaining.slice(0, start) + remaining.slice(end + TAG_CLOSE.length);
		searchFrom = start;
	}

	return remaining;
}

/**
 * Normalize a parsed tool call object so args are always under `args`.
 * Models differ in how they format tool calls:
 *   {"tool":"create_cell","args":{"outputName":...}}   ← correct
 *   {"tool":"create_cell","arguments":{"outputName":...}}  ← some models
 *   {"tool":"create_cell","outputName":"...","code":"..."}  ← flat (no wrapper)
 */
function normalizeToolCallArgs(obj: Record<string, unknown>): Record<string, unknown> {
	// Already has a non-empty args object
	if (obj.args && typeof obj.args === 'object' && Object.keys(obj.args as object).length > 0) {
		return obj.args as Record<string, unknown>;
	}
	// "arguments" key (OpenAI native format leaked into text)
	if (obj.arguments && typeof obj.arguments === 'object') {
		return obj.arguments as Record<string, unknown>;
	}
	// Flat format: every key except tool/callId/args/arguments is an arg
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { tool: _t, callId: _c, args: _a, arguments: _ar, ...rest } = obj;
	return rest;
}

/**
 * Some small Ollama models output raw JSON tool call objects as text content
 * instead of using the native tool_calls delta or <tool_call> XML tags.
 * This function detects and extracts those, normalising args format.
 *
 * Handles flat, nested (args/arguments), and mixed formats.
 * Prose before/after the JSON is preserved.
 */
function extractRawJsonToolCalls(text: string, onToolCall: (raw: string) => void): string {
	let result = text;

	while (true) {
		// Find the next {"tool": pattern anywhere in remaining text
		const matchIdx = result.search(/\{"tool"\s*:/);
		if (matchIdx === -1) break;

		// Find balanced braces starting from matchIdx
		let depth = 0,
			end = -1;
		for (let i = matchIdx; i < result.length; i++) {
			if (result[i] === '{') depth++;
			else if (result[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break; // incomplete JSON — leave in buffer

		const candidate = result.slice(matchIdx, end + 1);
		const obj = parseToolCallObject(candidate);
		if (obj && typeof obj.tool === 'string') {
			obj.args = normalizeToolCallArgs(obj);
			onToolCall(JSON.stringify(obj));
			result = result.slice(0, matchIdx) + result.slice(end + 1);
			continue;
		}
		break;
	}

	return result;
}

/**
 * Strip bare plan JSON objects (models that skip <plan> tags).
 * Handles any key order and finds objects via balanced-brace scanning.
 * Emits a plan_delta event for each stripped object.
 */
function stripBarePlanJson(
	text: string,
	onPlan: (plan: { tables?: string[]; cells?: string[]; approach?: string }) => void
): string {
	let result = text;
	while (true) {
		// Find the start of any bare plan JSON — either {"tables": or {"cells": (any order)
		const matchTables = result.search(/\{"tables"\s*:/);
		const matchCells = result.search(/\{"cells"\s*:/);
		const idx =
			matchTables === -1
				? matchCells
				: matchCells === -1
					? matchTables
					: Math.min(matchTables, matchCells);
		if (idx === -1) break;

		// Find the balanced closing brace
		let depth = 0,
			end = -1;
		for (let i = idx; i < result.length; i++) {
			if (result[i] === '{') depth++;
			else if (result[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break; // incomplete — leave in buffer

		const candidate = result.slice(idx, end + 1);
		try {
			const obj = JSON.parse(candidate) as Record<string, unknown>;
			if (Array.isArray(obj.tables) || Array.isArray(obj.cells)) {
				onPlan(obj as { tables?: string[]; cells?: string[]; approach?: string });
				result = result.slice(0, idx) + result.slice(end + 1);
				continue;
			}
		} catch {
			/* not valid JSON — skip past this start */
		}
		break;
	}
	return result;
}

/**
 * Strip complete and partial <think>...</think> blocks from buffered text.
 * Thinking models (e.g. qwen3) emit these before their actual response.
 * Complete blocks are removed; if a block is open but not yet closed, strip
 * from the opening tag onward (it may still be streaming).
 */
function stripThinkBlocks(text: string): string {
	// Remove complete <think>...</think> blocks
	let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
	// Remove incomplete open block (no closing tag yet)
	const openIdx = result.lastIndexOf('<think>');
	if (openIdx !== -1 && result.indexOf('</think>', openIdx) === -1) {
		result = result.slice(0, openIdx);
	}
	return result;
}

/**
 * Return the safe-to-emit prefix of `text` by stripping any incomplete
 * tag or raw JSON tool call at the tail. Handles:
 *   - a complete open tag with no close: "<tool_call>{"  → strips from "<"
 *   - a partial open tag at end: "<tool_ca" or just "<" → strips the partial
 *   - an incomplete {"tool":...} JSON at end (in-progress raw JSON tool call)
 */
function stripOpenTag(text: string): string {
	const TAG = '<tool_call>';

	// Remove complete open tag that has no matching close
	const idx = text.lastIndexOf('<tool_call>');
	if (idx !== -1 && text.indexOf('</tool_call>', idx) === -1) {
		return text.slice(0, idx);
	}

	// Hold back incomplete <done> blocks (streaming in)
	const doneIdx = text.lastIndexOf('<done>');
	if (doneIdx !== -1 && text.indexOf('</done>', doneIdx) === -1) {
		return text.slice(0, doneIdx);
	}

	// Hold back incomplete <plan> blocks (multi-line model plans stream slowly)
	const planIdx = text.lastIndexOf('<plan>');
	if (planIdx !== -1 && text.indexOf('</plan>', planIdx) === -1) {
		return text.slice(0, planIdx);
	}

	// Hold back incomplete <plan_proposal> blocks
	const planPropIdx = text.lastIndexOf('<plan_proposal>');
	if (planPropIdx !== -1 && text.indexOf('</plan_proposal>', planPropIdx) === -1) {
		return text.slice(0, planPropIdx);
	}

	// Hold back incomplete <sprint> and <sprint_update> blocks
	const sprintIdx = text.lastIndexOf('<sprint>');
	if (sprintIdx !== -1 && text.indexOf('</sprint>', sprintIdx) === -1) {
		return text.slice(0, sprintIdx);
	}
	const sprintUpdateIdx = text.lastIndexOf('<sprint_update>');
	if (sprintUpdateIdx !== -1 && text.indexOf('</sprint_update>', sprintUpdateIdx) === -1) {
		return text.slice(0, sprintUpdateIdx);
	}

	// Remove partial tag at end (e.g. "<tool_ca", "<t", "<", "<sprint", "<sp")
	const PARTIAL_WATCH = [TAG, '<done>', '<sprint>', '<sprint_update>', '<plan>', '<plan_proposal>'];
	const maxPartial = Math.max(...PARTIAL_WATCH.map((t) => t.length)) - 1;
	const start = Math.max(0, text.length - maxPartial);
	for (let i = start; i < text.length; i++) {
		const tail = text.slice(i);
		if (PARTIAL_WATCH.some((t) => t.startsWith(tail))) {
			return text.slice(0, i);
		}
	}

	// Hold back incomplete raw JSON tool call at end of buffer.
	// (When a model outputs {"tool":...} as plain text, we need to wait
	// for the complete object before extractRawJsonToolCalls can extract it.)
	const jsonIdx = text.search(/\{"tool"\s*:/);
	if (jsonIdx !== -1) {
		let depth = 0;
		for (let i = jsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, jsonIdx); // incomplete — hold back
	}

	// Hold back incomplete bare plan JSON {"tables":...} — same pattern as above.
	// Models sometimes emit plan JSON without <plan> tags; we need the complete
	// object before the bare-plan regex can match and strip it.
	const planJsonIdx = text.search(/\{"tables"\s*:/);
	if (planJsonIdx !== -1) {
		let depth = 0;
		for (let i = planJsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, planJsonIdx); // incomplete — hold back
	}

	// Hold back incomplete bare suggestions JSON {"suggestions":...}.
	// Cloud models often output suggestions without <done> tags; flushBareSuggestionsJson
	// extracts them but needs the complete object first.
	const suggestionsJsonIdx = text.search(/\{"suggestions"\s*:/);
	if (suggestionsJsonIdx !== -1) {
		let depth = 0;
		for (let i = suggestionsJsonIdx; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}') {
				depth--;
				if (depth === 0) break;
			}
		}
		if (depth > 0) return text.slice(0, suggestionsJsonIdx); // incomplete — hold back
	}

	return text;
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
		normalizeBaseUrl(body.llmConfig.baseUrl);
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
		connectionSchema,
		connectionDialect = 'duckdb',
		pythonAvailable = false
	} = req.notebookContext ?? {
		cells: [],
		connectionSchema: [],
		connectionDialect: 'duckdb' as const,
		pythonAvailable: false
	};
	const workspaceMemory = req.workspaceMemory;
	const completionUrl = `${normalizeBaseUrl(req.llmConfig.baseUrl)}/chat/completions`;

	// Local Ollama models use a compact directive prompt with explicit <tool_call> XML tags.
	// The full XML prompt is designed for smart cloud models (GPT-4, Claude) — it overwhelms
	// small models like qwen3:4b which need a much shorter, more directive template.
	const isOllama = req.llmConfig.provider === 'ollama';
	// Cloud models use native OpenAI-compatible tool calling (tools: [...] in the request body).
	// Ollama models continue to use XML <tool_call> tags — small models (Gemma, qwen3) follow
	// explicit tagged templates far more reliably than native tool_calls deltas.
	const useNativeTools = !isOllama;
	// Detect small models (≤8B) by parsing the model tag (e.g. qwen3:4b, gemma3:8b)
	const isSmall = isOllama && isSmallModel(req.llmConfig.model);

	const sessionDataContext = req.sessionDataContext;
	const sessionPlanContext = req.sessionPlanContext;
	const workspaceContract = req.workspaceContract;
	const schemaChangeNote = req.schemaChangeNote;
	const systemPrompt = req.subagentType
		? buildSubagentSystemPrompt(
				req.subagentType,
				cells,
				connectionSchema,
				sessionDataContext,
				workspaceContract,
				sessionPlanContext,
				connectionDialect,
				isOllama,
				isSmall
			)
		: isOllama
			? buildSystemPromptOllama(
					cells,
					connectionSchema,
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
					connectionSchema,
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
			// Stop the LLM stream after the first result-critical tool call so the model sees
			// real results before deciding its next action (proper one-result-at-a-time agent loop).
			const STOP_AFTER_TOOLS = new Set([
				'run_cells',
				'sample_data',
				'query_data',
				'profile_column',
				'get_cell_result'
			]);
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
					const activeTools = req.allowedTools
						? NATIVE_TOOLS.filter((t) =>
								req.allowedTools!.includes(t.function.name as AIChatToolName)
							)
						: NATIVE_TOOLS;
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
									emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
								});
								// stripOpenTag also holds back incomplete {"tool":...} at the tail
								const safeNative = stripOpenTag(nativeTextBuf);
								if (safeNative.length > 0) {
									send(ctrl, { type: 'text_delta', delta: safeNative });
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
									emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
									const parsedCall = parseToolCallObject(rawJson);
									if (parsedCall?.tool && STOP_AFTER_TOOLS.has(String(parsedCall.tool)))
										stoppedForResultTool = true;
								});
								// Also extract bare JSON tool calls (models that skip <tool_call> tags)
								buffer = extractRawJsonToolCalls(buffer, (rawJson) => {
									emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
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
									send(ctrl, { type: 'text_delta', delta: safeText });
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
					// Fallback: some models emit raw JSON tool calls as text content
					// rather than using the native tool_calls delta format.
					nativeTextBuf = extractRawJsonToolCalls(nativeTextBuf.trim(), (rawJson) => {
						emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
					});
					if (nativeTextBuf.trim()) send(ctrl, { type: 'text_delta', delta: nativeTextBuf.trim() });
				}

				// Emit any accumulated native tool calls (gated by allowedTools)
				for (const tc of Object.values(nativeToolCallBuf)) {
					if (!tc.name) continue;
					if (req.allowedTools && !req.allowedTools.includes(tc.name as AIChatToolName)) continue;
					callCounter++;
					let args: unknown = {};
					try {
						args = JSON.parse(tc.argsBuf || '{}');
					} catch {
						/* skip */
					}
					const toolCall: AIChatToolCall = {
						callId: tc.id || `auto_${callCounter}`,
						tool: tc.name as AIChatToolName,
						args: args as AIChatToolCall['args']
					};
					send(ctrl, { type: 'tool_call', call: toolCall });
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
						emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
					});
					// Also extract bare JSON tool calls left in the buffer
					buffer = extractRawJsonToolCalls(buffer, (rawJson) => {
						emitToolCall(ctrl, rawJson, req.allowedTools, () => `auto_${++callCounter}`);
					});
					const finalText = stripOpenTag(buffer).trim();
					if (finalText) send(ctrl, { type: 'text_delta', delta: finalText });
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
