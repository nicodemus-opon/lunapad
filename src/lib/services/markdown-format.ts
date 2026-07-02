export interface TextAreaState {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

export interface FormatResult {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

function getCurrentLine(
	text: string,
	pos: number
): { lineStart: number; lineEnd: number; lineText: string } {
	const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
	const nextNl = text.indexOf('\n', pos);
	const lineEnd = nextNl === -1 ? text.length : nextNl;
	return { lineStart, lineEnd, lineText: text.slice(lineStart, lineEnd) };
}

// Wraps selection with prefix+suffix. Toggles if already wrapped.
// If selection is empty, inserts prefix+placeholder+suffix and selects the placeholder.
export function wrapSelection(
	state: TextAreaState,
	prefix: string,
	suffix: string,
	placeholder = ''
): FormatResult {
	const { value, selectionStart: ss, selectionEnd: se } = state;
	const selected = value.slice(ss, se);

	// Toggle off if already wrapped
	if (
		selected.startsWith(prefix) &&
		selected.endsWith(suffix) &&
		selected.length >= prefix.length + suffix.length
	) {
		const inner = selected.slice(prefix.length, selected.length - suffix.length);
		return {
			value: value.slice(0, ss) + inner + value.slice(se),
			selectionStart: ss,
			selectionEnd: ss + inner.length
		};
	}

	// Also check if the surrounding characters are the wrapper (cursor is inside)
	if (ss === se) {
		const before = value.slice(ss - prefix.length, ss);
		const after = value.slice(se, se + suffix.length);
		if (before === prefix && after === suffix) {
			// Remove the wrapper
			return {
				value: value.slice(0, ss - prefix.length) + value.slice(se + suffix.length),
				selectionStart: ss - prefix.length,
				selectionEnd: ss - prefix.length
			};
		}
	}

	const inner = selected || placeholder;
	const next = value.slice(0, ss) + prefix + inner + suffix + value.slice(se);
	const newStart = ss + prefix.length;
	const newEnd = newStart + inner.length;
	return { value: next, selectionStart: newStart, selectionEnd: newEnd };
}

// Toggles a line prefix on the current line (or all lines in a multi-line selection).
export function toggleLinePrefix(state: TextAreaState, prefix: string): FormatResult {
	const { value, selectionStart: ss, selectionEnd: se } = state;

	const firstLine = getCurrentLine(value, ss);
	const lastLine = getCurrentLine(value, se === ss ? se : se - 1);

	const block = value.slice(firstLine.lineStart, lastLine.lineEnd);
	const lines = block.split('\n');
	const allHavePrefix = lines.every((l) => l.startsWith(prefix));

	const newLines = allHavePrefix
		? lines.map((l) => l.slice(prefix.length))
		: lines.map((l) => prefix + l);

	const newBlock = newLines.join('\n');
	const newValue = value.slice(0, firstLine.lineStart) + newBlock + value.slice(lastLine.lineEnd);

	const delta = newBlock.length - block.length;
	return {
		value: newValue,
		selectionStart: firstLine.lineStart,
		selectionEnd: lastLine.lineEnd + delta
	};
}

// Inserts text at cursor, replacing any selection.
export function insertAtCursor(state: TextAreaState, snippet: string): FormatResult {
	const { value, selectionStart: ss, selectionEnd: se } = state;
	const next = value.slice(0, ss) + snippet + value.slice(se);
	const newPos = ss + snippet.length;
	return { value: next, selectionStart: newPos, selectionEnd: newPos };
}

// Returns the list prefix to continue on the next line, or null if not on a list line.
// If the current line IS a list prefix but has no content, signals removeCurrentPrefix.
export function getListContinuation(
	state: TextAreaState
): { prefix: string; removeCurrentPrefix: boolean } | null {
	const { lineText } = getCurrentLine(state.value, state.selectionStart);

	// Unordered list: `- `, `* `, `+ `
	const unordered = lineText.match(/^(\s*)([-*+] )(.*)$/);
	if (unordered) {
		const [, indent, marker, content] = unordered;
		if (!content.trim()) return { prefix: indent + marker, removeCurrentPrefix: true };
		return { prefix: indent + marker, removeCurrentPrefix: false };
	}

	// Ordered list: `1. `, `12. `
	const ordered = lineText.match(/^(\s*)(\d+)\. (.*)$/);
	if (ordered) {
		const [, indent, numStr, content] = ordered;
		if (!content.trim()) return { prefix: indent + numStr + '. ', removeCurrentPrefix: true };
		const next = parseInt(numStr, 10) + 1;
		return { prefix: `${indent}${next}. `, removeCurrentPrefix: false };
	}

	return null;
}

// Indents/unindents the current list line. Returns null if not applicable (not a list line).
export function indentListLine(state: TextAreaState, direction: 'in' | 'out'): FormatResult | null {
	const { value, selectionStart: ss, selectionEnd: se } = state;
	const { lineStart, lineEnd, lineText } = getCurrentLine(value, ss);

	const isList = /^\s*([-*+]|\d+\.) /.test(lineText);
	if (!isList) return null;

	let newLine: string;
	if (direction === 'in') {
		newLine = '  ' + lineText;
	} else {
		newLine = lineText.startsWith('  ') ? lineText.slice(2) : lineText.replace(/^ /, '');
	}

	const delta = newLine.length - lineText.length;
	const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
	return {
		value: newValue,
		selectionStart: Math.max(lineStart, ss + delta),
		selectionEnd: Math.max(lineStart, se + delta)
	};
}

// Returns the text typed after a '/' at the start of the current line, or null.
export function getSlashToken(state: TextAreaState): string | null {
	const { value, selectionStart } = state;
	const { lineStart, lineText } = getCurrentLine(value, selectionStart);
	if (!lineText.startsWith('/')) return null;
	// Only trigger if cursor is still on the same line as the slash
	if (selectionStart < lineStart) return null;
	return lineText.slice(1, selectionStart - lineStart);
}

// Replaces the '/token' at the start of the current line with snippet.
export function applySlashCommand(state: TextAreaState, snippet: string): FormatResult {
	const { value, selectionStart } = state;
	const { lineStart, lineEnd } = getCurrentLine(value, selectionStart);
	const newValue = value.slice(0, lineStart) + snippet + value.slice(lineEnd);
	const newPos = lineStart + snippet.length;
	return { value: newValue, selectionStart: newPos, selectionEnd: newPos };
}

// Markdoc widget boilerplates — used by toolbar and slash palette.
export const WIDGET_SNIPPETS = {
	callout: '{% callout type="info" %}\nYour message here.\n{% /callout %}',
	metric: '{% metric value=$cell.value label="Label" /%}',
	chart: '{% chart type="bar" data=$cell.rows x="col_x" y="col_y" /%}',
	datatable: '{% datatable data=$cell.rows /%}',
	columns:
		'{% columns %}\n{% column %}\nLeft content.\n{% /column %}\n{% column %}\nRight content.\n{% /column %}\n{% /columns %}',
	tabs: '{% tabs %}\n{% tab label="Tab 1" %}\nContent.\n{% /tab %}\n{% /tabs %}',
	card: '{% card title="Title" %}\nContent.\n{% /card %}',
	details: '{% details summary="Click to expand" %}\nHidden content.\n{% /details %}',
	filter: '{% filter kind="dropdown" param="param" label="Label" options=[] /%}',
	mermaid: '{% mermaid %}\ngraph TD\n    A --> B\n{% /mermaid %}',
	badge: '{% badge value=$cell.status color="info" /%}',
	progress: '{% progress value=$cell.completed max=$cell.total label="Label" /%}',
	grid: '{% grid cols=3 %}\nContent.\n{% /grid %}',
	conditional: '{% if gt($cell.count, 0) %}\nContent.\n{% else /%}\nFallback.\n{% /if %}',
	pivotTable:
		'{% datatable data=$cell.rows index=["group_col"] pivotBy="pivot_col" valueCol="value_col" agg="sum" valueFormatKind="number" /%}',
	summaryTable:
		'{% datatable data=$cell.rows index=["group_col"] valueCol="value_col" agg="sum" valueFormatKind="number" /%}',
	mermaidLoop:
		'{% mermaid %}\nkanban\n  {% group data=$cell.rows by="status" %}\n  $keyId[$key]\n    {% each data=$items %}\n    task_$id[$title]\n    {% /each %}\n  {% /group %}\n{% /mermaid %}'
} as const;

export interface SlashCommand {
	id: string;
	label: string;
	description: string;
	snippet: string;
	group: 'heading' | 'structure' | 'widget';
}

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		id: 'h1',
		label: 'Heading 1',
		description: 'Large section header',
		snippet: '# ',
		group: 'heading'
	},
	{
		id: 'h2',
		label: 'Heading 2',
		description: 'Medium section header',
		snippet: '## ',
		group: 'heading'
	},
	{
		id: 'h3',
		label: 'Heading 3',
		description: 'Small section header',
		snippet: '### ',
		group: 'heading'
	},
	{
		id: 'divider',
		label: 'Divider',
		description: 'Horizontal rule',
		snippet: '\n---\n',
		group: 'structure'
	},
	{ id: 'quote', label: 'Quote', description: 'Blockquote', snippet: '> ', group: 'structure' },
	{
		id: 'code',
		label: 'Code block',
		description: 'Fenced code block',
		snippet: '```sql\n\n```',
		group: 'structure'
	},
	{
		id: 'callout',
		label: 'Callout',
		description: 'Info / warning box',
		snippet: WIDGET_SNIPPETS.callout,
		group: 'widget'
	},
	{
		id: 'card',
		label: 'Card',
		description: 'Bordered card',
		snippet: WIDGET_SNIPPETS.card,
		group: 'widget'
	},
	{
		id: 'metric',
		label: 'Metric',
		description: 'KPI metric widget',
		snippet: WIDGET_SNIPPETS.metric,
		group: 'widget'
	},
	{
		id: 'chart',
		label: 'Chart',
		description: 'Chart from cell data',
		snippet: WIDGET_SNIPPETS.chart,
		group: 'widget'
	},
	{
		id: 'datatable',
		label: 'Data table',
		description: 'Table from cell data',
		snippet: WIDGET_SNIPPETS.datatable,
		group: 'widget'
	},
	{
		id: 'summary-table',
		label: 'Summary table',
		description: 'Grouped aggregate table',
		snippet: WIDGET_SNIPPETS.summaryTable,
		group: 'widget'
	},
	{
		id: 'pivot-table',
		label: 'Pivot table',
		description: 'Crosstab table from cell data',
		snippet: WIDGET_SNIPPETS.pivotTable,
		group: 'widget'
	},
	{
		id: 'columns',
		label: 'Columns',
		description: 'Multi-column layout',
		snippet: WIDGET_SNIPPETS.columns,
		group: 'widget'
	},
	{
		id: 'tabs',
		label: 'Tabs',
		description: 'Tabbed sections',
		snippet: WIDGET_SNIPPETS.tabs,
		group: 'widget'
	},
	{
		id: 'details',
		label: 'Details',
		description: 'Collapsible section',
		snippet: WIDGET_SNIPPETS.details,
		group: 'widget'
	},
	{
		id: 'filter',
		label: 'Filter',
		description: 'Interactive filter widget',
		snippet: WIDGET_SNIPPETS.filter,
		group: 'widget'
	},
	{
		id: 'conditional',
		label: 'Conditional',
		description: 'Show content only when a condition matches',
		snippet: WIDGET_SNIPPETS.conditional,
		group: 'widget'
	},
	{
		id: 'badge',
		label: 'Badge',
		description: 'Colored status badge',
		snippet: WIDGET_SNIPPETS.badge,
		group: 'widget'
	},
	{
		id: 'progress',
		label: 'Progress',
		description: 'Progress bar',
		snippet: WIDGET_SNIPPETS.progress,
		group: 'widget'
	},
	{
		id: 'grid',
		label: 'Grid',
		description: 'Responsive grid layout',
		snippet: WIDGET_SNIPPETS.grid,
		group: 'widget'
	},
	{
		id: 'mermaid',
		label: 'Mermaid diagram',
		description: 'Flowchart, sequence, pie, ER, gantt, git…',
		snippet: '```mermaid\ngraph TD\n    A --> B\n```',
		group: 'structure'
	},
	{
		id: 'mermaid-loop',
		label: 'Dynamic Mermaid loop',
		description: 'Mermaid template with group/each blocks',
		snippet: WIDGET_SNIPPETS.mermaidLoop,
		group: 'widget'
	}
];
