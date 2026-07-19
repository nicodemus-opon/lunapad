import { SLASH_COMPONENT_CATALOG } from '$lib/services/component-capabilities';
export { WIDGET_SNIPPETS } from '$lib/services/markdoc-snippets';
import { WIDGET_SNIPPETS } from '$lib/services/markdoc-snippets';

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

export interface SlashCommand {
	id: string;
	label: string;
	description: string;
	snippet: string;
	group: 'heading' | 'structure' | 'widget' | 'query' | 'report' | 'input' | 'data' | 'ai';
	/** Extra search terms that match this command in the slash menu (e.g. "hr" for divider). */
	aliases?: string[];
}

const MARKDOC_SLASH_LABELS: Record<string, string> = {
	datatable: 'Data table',
	each: 'Each loop',
	group: 'Group loop',
	if: 'Conditional',
	else: 'Else branch',
	details: 'Toggle (collapsible)'
};

function labelForMarkdocTag(tagName: string): string {
	return (
		MARKDOC_SLASH_LABELS[tagName] ??
		tagName
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ')
	);
}

function commandFromComponentCatalog(
	entry: (typeof SLASH_COMPONENT_CATALOG)[number]
): SlashCommand {
	return {
		id: entry.id,
		label: labelForMarkdocTag(entry.id),
		description: entry.description,
		snippet: entry.snippet,
		group: 'widget',
		aliases: entry.aliases
	};
}

const MARKDOC_SLASH_COMMANDS: SlashCommand[] = SLASH_COMPONENT_CATALOG.map(
	commandFromComponentCatalog
);

const MARKDOC_REPORT_COMMANDS: SlashCommand[] = [
	{
		id: 'report-summary',
		label: 'Summary report',
		description: 'Metrics, chart, and rows from an existing result',
		snippet: '',
		group: 'report'
	},
	{
		id: 'report-filtered',
		label: 'Filtered report',
		description: 'Filter control wired to chart and table',
		snippet: '',
		group: 'report'
	},
	{
		id: 'report-grouped',
		label: 'Grouped sections',
		description: 'Repeat nested content by a dimension',
		snippet: '',
		group: 'report'
	},
	{
		id: 'report-tabs',
		label: 'Tabbed drilldown',
		description: 'Chart, rows, and grouped detail tabs',
		snippet: '',
		group: 'report'
	}
];

const MARKDOC_PRESET_SLASH_COMMANDS: SlashCommand[] = [
	{
		id: 'input-text',
		label: 'Text input',
		description: 'Report parameter text box',
		snippet: '{% filter kind="text-input" param="search" label="Search" /%}',
		group: 'input',
		aliases: ['parameter', 'control']
	},
	{
		id: 'input-number',
		label: 'Number input',
		description: 'Min/max numeric parameter',
		snippet:
			'{% filter kind="numeric-range" label="Value range" minParam="min_value" maxParam="max_value" /%}',
		group: 'input',
		aliases: ['numeric', 'range']
	},
	{
		id: 'input-date-range',
		label: 'Date range input',
		description: 'Start and end date parameters',
		snippet:
			'{% filter kind="date-range" label="Date range" startParam="start_date" endParam="end_date" /%}',
		group: 'input',
		aliases: ['date', 'calendar']
	},
	{
		id: 'input-select',
		label: 'Select input',
		description: 'Dropdown report parameter',
		snippet:
			'{% filter kind="dropdown" param="status" label="Status" options=["active","pending"] /%}',
		group: 'input',
		aliases: ['dropdown']
	},
	{
		id: 'input-multiselect',
		label: 'Multiselect input',
		description: 'Multi-choice report parameter',
		snippet:
			'{% filter kind="multi-select" param="status" label="Status" options=["active","pending","archived"] /%}',
		group: 'input',
		aliases: ['multi-select', 'checkboxes']
	},
	{
		id: 'input-button-group',
		label: 'Button group input',
		description: 'Segmented report parameter',
		snippet:
			'{% filter kind="button-group" param="period" label="Period" options=["week","month","quarter"] /%}',
		group: 'input',
		aliases: ['buttons', 'segments', 'tabs']
	},
	{
		id: 'map',
		label: 'Map',
		description: 'Map chart from latitude and longitude',
		snippet:
			'{% chart type="map" data=[{"city":"Nairobi","lat":-1.2921,"lon":36.8219,"value":12}] x="city" y="value" lat="lat" lon="lon" /%}',
		group: 'data',
		aliases: ['geo', 'latitude', 'longitude']
	},
	{
		id: 'single-value',
		label: 'Single value',
		description: 'Big-number metric widget',
		snippet: '{% metric value=12 label="value" vs=8 format="compact" /%}',
		group: 'data',
		aliases: ['big number', 'kpi']
	},
	{
		id: 'conditional',
		label: 'Conditional',
		description: 'Show content only when a condition matches',
		snippet: WIDGET_SNIPPETS.conditional,
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
		id: 'mermaid-loop',
		label: 'Dynamic Mermaid loop',
		description: 'Mermaid template with group/each blocks',
		snippet: WIDGET_SNIPPETS.mermaidLoop,
		group: 'widget'
	}
];

const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		id: 'sql',
		label: 'SQL query',
		description: 'Inline SQL query block',
		snippet: '',
		group: 'query'
	},
	{
		id: 'prql',
		label: 'PRQL query',
		description: 'Inline PRQL query block',
		snippet: '',
		group: 'query'
	},
	{
		id: 'python',
		label: 'Python block',
		description: 'Inline Python cell',
		snippet: '',
		group: 'query'
	},
	{
		id: 'plot',
		label: 'Plot',
		description: 'Chart auto-picked from the nearest query above',
		snippet: '',
		group: 'query',
		aliases: ['chart', 'graph']
	},
	{
		id: 'plot-bar',
		label: 'Plot: Bar chart',
		description: 'Chart preloaded as a bar chart',
		snippet: '',
		group: 'query'
	},
	{
		id: 'plot-line',
		label: 'Plot: Line chart',
		description: 'Chart preloaded as a line chart',
		snippet: '',
		group: 'query'
	},
	{
		id: 'plot-scatter',
		label: 'Plot: Scatter plot',
		description: 'Chart preloaded as a scatter plot',
		snippet: '',
		group: 'query'
	},
	{
		id: 'plot-pie',
		label: 'Plot: Pie chart',
		description: 'Chart preloaded as a pie chart',
		snippet: '',
		group: 'query'
	},
	{
		id: 'plot-area',
		label: 'Plot: Area chart',
		description: 'Chart preloaded as an area chart',
		snippet: '',
		group: 'query'
	},
	{
		id: 'page',
		label: 'Sub-page',
		description: 'Nested page section',
		snippet: '',
		group: 'query'
	},
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
		id: 'h4',
		label: 'Heading 4',
		description: 'Sub-section header',
		snippet: '#### ',
		group: 'heading'
	},
	{
		id: 'h5',
		label: 'Heading 5',
		description: 'Sub-section header',
		snippet: '##### ',
		group: 'heading'
	},
	{
		id: 'h6',
		label: 'Heading 6',
		description: 'Sub-section header',
		snippet: '###### ',
		group: 'heading'
	},
	{
		id: 'divider',
		label: 'Divider',
		description: 'Horizontal rule',
		snippet: '\n---\n',
		group: 'structure',
		aliases: ['hr', 'rule', 'line', 'separator']
	},
	{
		id: 'bullet',
		label: 'Bullet list',
		description: 'Unordered list',
		snippet: '- ',
		group: 'structure'
	},
	{
		id: 'numbered',
		label: 'Numbered list',
		description: 'Ordered list',
		snippet: '1. ',
		group: 'structure'
	},
	{
		id: 'task',
		label: 'To-do list',
		description: 'Task list with checkboxes',
		snippet: '- [ ] ',
		group: 'structure',
		aliases: ['todo', 'checkbox']
	},
	{
		id: 'table',
		label: 'Table',
		description: '3×3 table with header row',
		snippet: '| Col | Col |\n| --- | --- |\n| | |',
		group: 'structure'
	},
	{
		id: 'image',
		label: 'Image',
		description: 'Embed an image by URL',
		snippet: '![](https://)',
		group: 'structure',
		aliases: ['img', 'photo', 'picture']
	},
	{
		id: 'link',
		label: 'Link',
		description: 'Insert a hyperlink',
		snippet: '',
		group: 'structure',
		aliases: ['url', 'href', 'hyperlink']
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
		id: 'emoji',
		label: 'Emoji',
		description: 'Insert an emoji',
		snippet: '😀',
		group: 'structure'
	},
	{
		id: 'mermaid',
		label: 'Mermaid diagram',
		description: 'Flowchart, sequence, pie, ER, gantt, git…',
		snippet: '```mermaid\ngraph TD\n    A --> B\n```',
		group: 'structure'
	}
];

export const SLASH_COMMANDS: SlashCommand[] = [
	...BASE_SLASH_COMMANDS.slice(0, 4),
	...MARKDOC_REPORT_COMMANDS,
	...BASE_SLASH_COMMANDS.slice(4),
	...MARKDOC_SLASH_COMMANDS,
	...MARKDOC_PRESET_SLASH_COMMANDS
];
