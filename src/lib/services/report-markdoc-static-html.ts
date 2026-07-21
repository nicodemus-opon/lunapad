import Markdoc from '@markdoc/markdoc';
import type { RenderableTreeNode, Tag } from '@markdoc/markdoc';
import type { Cell } from '$lib/stores/notebook.svelte';
import { renderMarkdocCell } from '$lib/services/markdoc-interp';
import {
	textFromMarkdocChildren,
	buildNotebookOutline,
	resolveHeadingAnchorId
} from '$lib/services/notebook-outline';
import type { ColumnFormatKind } from '$lib/services/column-format';
import type { TableAggKind } from '$lib/services/report-table-summary';
import { renderReportTableToStaticHtml } from '$lib/services/report-table-static-html';
import { sanitizeUrl } from '$lib/services/safe-url';
import { embedUrlToIframeSrc } from '$lib/services/embed-providers';
import katex from 'katex';
import { pivotTable } from '$lib/services/report-table-pivot';
import { summarizeTable } from '$lib/services/report-table-summary';
import type {
	ColumnConditionalRules,
	ReportTableConditionalRule
} from '$lib/services/report-table-conditional-format';
import { resolveSemanticToken, type SemanticTone } from '$lib/components/markdown/semantic-tone';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('sql', sql);
hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);

const TagImpl = Markdoc.Tag;

/** Same highlighting used by the live editor's CodeBlock.svelte — only adds
 * <span class="hljs-*"> tags, so the result is safe to inline as HTML. */
export function highlightCodeToStaticHtml(code: string, lang: string): string {
	if (!code) return '';
	if (lang && hljs.getLanguage(lang)) {
		return hljs.highlight(code, { language: lang }).value;
	}
	return escapeHtml(code);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function parseSimpleMarkdocTable(
	input: Tag
): { columns: string[]; rows: Record<string, unknown>[] } | null {
	const children = (input.children ?? []) as unknown[];

	const thead = children.find((c) => TagImpl.isTag(c) && (c as Tag).name === 'thead') as
		| Tag
		| undefined;
	const tbody = children.find((c) => TagImpl.isTag(c) && (c as Tag).name === 'tbody') as
		| Tag
		| undefined;
	if (!thead || !tbody) return null;

	const headerTr = (thead.children ?? []).find(
		(c) => TagImpl.isTag(c) && (c as Tag).name === 'tr'
	) as Tag | undefined;
	const headerCells = (headerTr?.children ?? []).filter(
		(c) => TagImpl.isTag(c) && ((c as Tag).name === 'th' || (c as Tag).name === 'td')
	) as Tag[];

	const columns = headerCells
		.map((th) => textFromMarkdocChildren(th.children as unknown[]).trim())
		.filter(Boolean);

	if (columns.length === 0) return null;
	if (columns.length > 30) return null;

	const rowTrs = (tbody.children ?? []).filter(
		(c) => TagImpl.isTag(c) && (c as Tag).name === 'tr'
	) as Tag[];

	const MAX_ROWS = 500;
	const trimmedTrs = rowTrs.slice(0, MAX_ROWS);

	const rows = trimmedTrs.map((tr) => {
		const cellTags = (tr.children ?? []).filter(
			(c) => TagImpl.isTag(c) && ((c as Tag).name === 'td' || (c as Tag).name === 'th')
		) as Tag[];

		const row: Record<string, unknown> = {};
		for (let i = 0; i < columns.length; i++) {
			const cell = cellTags[i];
			row[columns[i]] = cell ? textFromMarkdocChildren(cell.children as unknown[]).trim() : '';
		}
		return row;
	});

	return { columns, rows };
}

function datatableTagToStaticTable(tag: Tag): string {
	const attrs = tag.attributes as Record<string, unknown>;
	const data = (attrs.data ?? []) as Record<string, unknown>[];
	const limit = typeof attrs.limit === 'number' ? attrs.limit : 10;
	const cols = (attrs.cols as string[] | undefined) ?? [];

	const pivotBy = typeof attrs.pivotBy === 'string' ? attrs.pivotBy : undefined;
	const valueCol = typeof attrs.valueCol === 'string' ? attrs.valueCol : undefined;
	const agg = (typeof attrs.agg === 'string' ? (attrs.agg as TableAggKind) : 'sum') as TableAggKind;
	const round = typeof attrs.round === 'number' ? attrs.round : undefined;
	const valueCurrencySymbol =
		typeof attrs.valueCurrencySymbol === 'string' ? attrs.valueCurrencySymbol : undefined;
	const valueFormatKind =
		typeof attrs.valueFormatKind === 'string'
			? (attrs.valueFormatKind as ColumnFormatKind)
			: undefined;
	const index = Array.isArray(attrs.index) ? (attrs.index as string[]) : undefined;
	const conditionalFormats = Array.isArray(attrs.conditionalFormats)
		? (attrs.conditionalFormats as Array<{ column: string; rules: ReportTableConditionalRule[] }>)
		: [];
	const conditionalRuleMap: ColumnConditionalRules = {};
	for (const item of conditionalFormats) {
		if (!item || typeof item !== 'object') continue;
		if (typeof item.column !== 'string' || !Array.isArray(item.rules)) continue;
		conditionalRuleMap[item.column] = item.rules;
	}

	const columns = cols.length > 0 ? cols : data[0] ? Object.keys(data[0]) : [];

	const src = data.slice(0, limit);

	const resolvedIndex =
		index && index.length
			? index
			: pivotBy && valueCol
				? columns.filter((c) => c !== pivotBy && c !== valueCol)
				: (index ?? []);

	if (pivotBy && valueCol && resolvedIndex.length) {
		const pivot = pivotTable(src, {
			index: resolvedIndex,
			pivotBy,
			valueCol,
			agg,
			round,
			valueFormatKind,
			valueCurrencySymbol
		});

		return renderReportTableToStaticHtml(pivot.rows, pivot.columns, {
			maxRows: pivot.rows.length,
			truncated: data.length > limit,
			columnFormatOverrides: pivot.formatOverrides,
			columnFormatRules: conditionalRuleMap
		});
	}

	if (valueCol && resolvedIndex.length) {
		const summary = summarizeTable(src, {
			groupBy: resolvedIndex,
			valueCol,
			agg,
			round,
			valueFormatKind,
			valueCurrencySymbol
		});

		return renderReportTableToStaticHtml(summary.rows, summary.columns, {
			maxRows: summary.rows.length,
			truncated: data.length > limit,
			columnFormatOverrides: summary.formatOverrides,
			columnFormatRules: conditionalRuleMap
		});
	}

	return renderReportTableToStaticHtml(src, columns, {
		maxRows: src.length,
		truncated: data.length > limit,
		columnFormatRules: conditionalRuleMap
	});
}

const METRIC_CURRENCY_FMT = new Intl.NumberFormat(undefined, {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0
});
const METRIC_COMPACT_FMT = new Intl.NumberFormat(undefined, {
	notation: 'compact',
	maximumFractionDigits: 1
});
const METRIC_DATE_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// Mirrors MetricWidget.svelte's `displayValue` derivation so the static export
// shows the same formatted number the live report/editor would.
function formatMetricValue(value: unknown, format: string): string {
	if (value == null) return '—';
	if (format === 'date') {
		const d = new Date(typeof value === 'number' ? value : String(value));
		return Number.isNaN(d.getTime()) ? String(value) : METRIC_DATE_FMT.format(d);
	}
	const n = typeof value === 'number' ? value : Number(value);
	if (Number.isNaN(n)) return String(value);
	switch (format) {
		case 'currency':
			return METRIC_CURRENCY_FMT.format(n);
		case 'compact':
			return METRIC_COMPACT_FMT.format(n);
		case 'percent':
			return `${n.toFixed(1)}%`;
		default:
			return n.toLocaleString();
	}
}

function metricTagToStaticHtml(tag: Tag): string {
	const attrs = tag.attributes as Record<string, unknown>;
	const value = formatMetricValue(
		attrs.value,
		typeof attrs.format === 'string' ? attrs.format : 'number'
	);
	const label = typeof attrs.label === 'string' && attrs.label ? escapeHtml(attrs.label) : '';
	const trend = attrs.trend === 'up' || attrs.trend === 'down' ? attrs.trend : null;
	const deltaPct = typeof attrs.deltaPct === 'number' ? attrs.deltaPct : null;
	const accentToken = resolveSemanticToken(
		attrs.accent as SemanticTone | undefined,
		'var(--foreground)'
	);
	let delta = '';
	if (trend && deltaPct != null) {
		const arrow = trend === 'up' ? '▲' : '▼';
		delta = `<span class="markdoc-metric-delta markdoc-metric-delta--${trend}">${arrow} ${Math.abs(deltaPct).toFixed(1)}%</span>`;
	}
	return `<span class="markdoc-metric" style="--markdoc-metric-accent:${escapeHtml(accentToken)}"><span class="markdoc-metric-value">${escapeHtml(value)}</span>${delta}${label ? `<span class="markdoc-metric-label">${label}</span>` : ''}</span>`;
}

function badgeTagToStaticHtml(tag: Tag): string {
	const attrs = tag.attributes as Record<string, unknown>;
	const value = attrs.value ?? '';
	const CHART_TOKENS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	];
	let hash = 0;
	const str = String(value);
	for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
	const fallback = CHART_TOKENS[hash % CHART_TOKENS.length];
	const token = resolveSemanticToken(attrs.color as SemanticTone | undefined, fallback);
	return `<span class="markdoc-badge" style="--markdoc-badge-token:${escapeHtml(token)}">${escapeHtml(str)}</span>`;
}

function progressTagToStaticHtml(tag: Tag): string {
	const attrs = tag.attributes as Record<string, unknown>;
	const value = typeof attrs.value === 'number' ? attrs.value : 0;
	const max = typeof attrs.max === 'number' ? attrs.max : 100;
	const label = typeof attrs.label === 'string' && attrs.label ? escapeHtml(attrs.label) : '';
	const color = typeof attrs.color === 'string' ? attrs.color : 'info';
	const token =
		color === 'success'
			? 'var(--success)'
			: color === 'warning'
				? 'var(--warning)'
				: color === 'error'
					? 'var(--destructive)'
					: 'var(--chart-1)';
	const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
	return `<div class="markdoc-progress">${label ? `<div class="markdoc-progress-label">${label}</div>` : ''}<div class="markdoc-progress-track"><div class="markdoc-progress-fill" style="width:${pct}%;background:${token}"></div></div><div class="markdoc-progress-value">${pct.toFixed(0)}%</div></div>`;
}

// Plotly charts can't run in a static file, so fall back to the underlying
// table data (rather than a blank div) — same data the live chart plots.
function chartTagToStaticHtml(tag: Tag): string {
	const attrs = tag.attributes as Record<string, unknown>;
	const data = Array.isArray(attrs.data) ? (attrs.data as Record<string, unknown>[]) : [];
	const title = typeof attrs.title === 'string' && attrs.title ? escapeHtml(attrs.title) : '';
	if (!data.length) {
		return `<div class="markdoc-chart-fallback">${title ? `<p class="markdoc-chart-fallback-title">${title}</p>` : ''}<p class="markdoc-chart-fallback-note">Chart has no data.</p></div>`;
	}
	const xColumn = typeof attrs.xColumn === 'string' ? attrs.xColumn : undefined;
	const yColumns = Array.isArray(attrs.yColumns) ? (attrs.yColumns as string[]) : [];
	const columns = xColumn && yColumns.length ? [xColumn, ...yColumns] : Object.keys(data[0]);
	const tableHtml = renderReportTableToStaticHtml(data, columns, {
		maxRows: 50,
		truncated: data.length > 50
	});
	return `<div class="markdoc-chart-fallback">${title ? `<p class="markdoc-chart-fallback-title">${title}</p>` : ''}<p class="markdoc-chart-fallback-note">Interactive chart available in the live report view — showing underlying data.</p>${tableHtml}</div>`;
}

// Standard HTML elements we emit verbatim (wrapping their rendered children).
// Headings (h1-h6) are handled separately above so they can carry a TOC-matching id.
const WRAP_TAGS = new Set([
	'p',
	'ul',
	'ol',
	'li',
	'blockquote',
	'strong',
	'em',
	'del',
	'code',
	'a',
	'span',
	'div',
	'sup',
	'sub'
]);

// Self-closing HTML elements.
const VOID_TAGS = new Set(['hr', 'br', 'img']);

function renderTagAttributes(name: string, attributes: Record<string, unknown>): string {
	const parts: string[] = [];
	if (name === 'a' && typeof attributes.href === 'string') {
		const safeHref = sanitizeUrl(attributes.href);
		if (safeHref) {
			parts.push(`href="${escapeHtml(safeHref)}"`);
			// Plain markdown links carry no target/rel; open external links in a new
			// tab without leaking window.opener, matching the live editor's behavior.
			if (/^https?:\/\//i.test(safeHref)) {
				parts.push('target="_blank"', 'rel="noopener noreferrer"');
			}
		}
	}
	if (name === 'img') {
		if (typeof attributes.src === 'string') {
			const safeSrc = sanitizeUrl(attributes.src);
			if (safeSrc) parts.push(`src="${escapeHtml(safeSrc)}"`);
		}
		if (typeof attributes.alt === 'string') parts.push(`alt="${escapeHtml(attributes.alt)}"`);
	}
	return parts.length ? ` ${parts.join(' ')}` : '';
}

function renderGenericMarkdocWrapper(
	tagName: string,
	childrenHtml: string,
	extraAttrs: string[] = []
): string {
	const attrs = [`data-markdoc-tag="${escapeHtml(tagName)}"`, ...extraAttrs].join(' ');
	return `<div ${attrs}>${childrenHtml}</div>`;
}

function renderRenderableToStaticHtml(node: RenderableTreeNode): string {
	if (node === null || node === undefined || node === false || node === true) return '';
	if (typeof node === 'string') return escapeHtml(node);
	if (typeof node === 'number') return escapeHtml(String(node));

	if (Array.isArray(node)) {
		return node.map((n) => renderRenderableToStaticHtml(n)).join('');
	}

	if (TagImpl.isTag(node)) {
		const tag = node as Tag;

		// Rich, first-class table rendering for our widgets.
		if (tag.name === 'datatable') return datatableTagToStaticTable(tag);

		// Fenced code block — Markdoc emits this as a `pre` tag with a `data-language`
		// attribute and raw text children (see MarkdocNode.svelte's `pre` branch, which
		// hands the same shape to CodeBlock.svelte). Highlight it the same way here so
		// the static export doesn't regress to plain unhighlighted text.
		if (tag.name === 'pre') {
			const lang = String((tag.attributes as Record<string, unknown>)?.['data-language'] ?? '');
			const rawCode = textFromMarkdocChildren((tag.children ?? []) as unknown[]);
			const highlighted = highlightCodeToStaticHtml(rawCode, lang);
			return `<pre class="hljs-block"><code class="language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
		}

		if (tag.name === 'metric') return metricTagToStaticHtml(tag);
		if (tag.name === 'badge') return badgeTagToStaticHtml(tag);
		if (tag.name === 'progress') return progressTagToStaticHtml(tag);
		if (tag.name === 'chart') return chartTagToStaticHtml(tag);
		// Inline {% filter %} tags are always consolidated into one filter bar on the
		// live report page (ReportPage.svelte suppresses them inline whenever any exist
		// — see FilterWidget.svelte's suppressInline) — the export route renders that
		// bar itself from the same tags, so the inline tag renders nothing here too.
		if (tag.name === 'filter') return '';

		if (tag.name === 'table') {
			const parsed = parseSimpleMarkdocTable(tag);
			if (parsed) {
				return renderReportTableToStaticHtml(parsed.rows, parsed.columns, {
					maxRows: parsed.rows.length
				});
			}
			// Fall through to generic rendering when the shape is unexpected.
		}

		if (VOID_TAGS.has(tag.name)) {
			return `<${tag.name}${renderTagAttributes(tag.name, tag.attributes as Record<string, unknown>)} />`;
		}

		const childrenHtml = ((tag.children ?? []) as RenderableTreeNode[])
			.map((c) => renderRenderableToStaticHtml(c))
			.join('');

		// Headings need a matching `id` so `{% toc %}` links (built from the same
		// per-cell anchor scheme as the live editor/report — see notebook-outline.ts)
		// actually land somewhere instead of no-op-ing in the exported file.
		if (/^h[1-6]$/.test(tag.name)) {
			const label = textFromMarkdocChildren((tag.children ?? []) as unknown[]);
			const id =
				currentHeadingCellId && label.trim()
					? resolveHeadingAnchorId(currentHeadingCellId, label, currentHeadingSlugTracker)
					: undefined;
			const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
			return `<${tag.name}${idAttr}${renderTagAttributes(tag.name, tag.attributes as Record<string, unknown>)}>${childrenHtml}</${tag.name}>`;
		}

		if (WRAP_TAGS.has(tag.name)) {
			return `<${tag.name}${renderTagAttributes(tag.name, tag.attributes as Record<string, unknown>)}>${childrenHtml}</${tag.name}>`;
		}

		const attrs = tag.attributes as Record<string, unknown>;
		if (tag.name === 'columns') {
			return renderGenericMarkdocWrapper(tag.name, childrenHtml, ['class="markdoc-columns"']);
		}
		if (tag.name === 'column') {
			const width =
				attrs.width !== undefined ? ` style="flex-basis:${escapeHtml(String(attrs.width))}"` : '';
			return `<div data-markdoc-tag="column" class="markdoc-column"${width}>${childrenHtml}</div>`;
		}
		if (tag.name === 'grid') {
			const cols = typeof attrs.cols === 'number' ? attrs.cols : 3;
			return renderGenericMarkdocWrapper(tag.name, childrenHtml, [
				'class="markdoc-grid"',
				`style="--markdoc-grid-cols:${cols}"`
			]);
		}
		if (tag.name === 'callout') {
			const tone = escapeHtml(String(attrs.type ?? 'info'));
			const title =
				typeof attrs.title === 'string' && attrs.title
					? `<p class="markdoc-callout-title">${escapeHtml(attrs.title)}</p>`
					: '';
			return `<aside data-markdoc-tag="callout" class="markdoc-callout markdoc-callout--${tone}"><span class="markdoc-callout-icon"></span><div class="markdoc-callout-body">${title}${childrenHtml}</div></aside>`;
		}
		if (tag.name === 'card') {
			const title =
				typeof attrs.title === 'string'
					? `<div class="markdoc-card-title">${escapeHtml(attrs.title)}</div>`
					: '';
			return `<section data-markdoc-tag="card" class="markdoc-card">${title}${childrenHtml}</section>`;
		}
		if (tag.name === 'details') {
			const summary = escapeHtml(String(attrs.summary ?? 'Details'));
			const open = attrs.open ? ' open' : '';
			return `<details data-markdoc-tag="details" class="markdoc-details"${open}><summary>${summary}</summary>${childrenHtml}</details>`;
		}
		if (tag.name === 'tabs') {
			return renderGenericMarkdocWrapper(tag.name, childrenHtml, ['class="markdoc-tabs"']);
		}
		if (tag.name === 'tab') {
			const label = escapeHtml(String(attrs.label ?? 'Tab'));
			return `<section data-markdoc-tag="tab" data-tab-label="${label}" class="markdoc-tab"><h3>${label}</h3>${childrenHtml}</section>`;
		}
		if (tag.name === 'mermaid') {
			const code = typeof attrs.code === 'string' ? attrs.code : childrenHtml;
			return `<pre data-markdoc-tag="mermaid" class="markdoc-mermaid"><code>${escapeHtml(code)}</code></pre>`;
		}
		if (tag.name === 'video') {
			const safeSrc = typeof attrs.src === 'string' ? sanitizeUrl(attrs.src) : '';
			if (!safeSrc) return '';
			const poster =
				typeof attrs.poster === 'string' && sanitizeUrl(attrs.poster)
					? ` poster="${escapeHtml(sanitizeUrl(attrs.poster))}"`
					: '';
			const loop = attrs.loop ? ' loop' : '';
			const muted = attrs.muted ? ' muted' : '';
			return `<video data-markdoc-tag="video" class="markdoc-video" src="${escapeHtml(safeSrc)}"${poster}${loop}${muted} controls playsinline></video>`;
		}
		if (tag.name === 'embed') {
			const safeUrl = typeof attrs.url === 'string' ? sanitizeUrl(attrs.url) : '';
			if (!safeUrl) return '';
			const iframeSrc = embedUrlToIframeSrc(safeUrl);
			if (iframeSrc) {
				return `<div data-markdoc-tag="embed" class="markdoc-embed"><iframe src="${escapeHtml(iframeSrc)}" title="Embedded content" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="no-referrer"></iframe></div>`;
			}
			return `<a data-markdoc-tag="embed" class="markdoc-embed-fallback" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(safeUrl)}</a>`;
		}
		if (tag.name === 'bookmark') {
			const safeUrl = typeof attrs.url === 'string' ? sanitizeUrl(attrs.url) : '';
			if (!safeUrl) return '';
			const title = typeof attrs.title === 'string' && attrs.title ? attrs.title : safeUrl;
			const description =
				typeof attrs.description === 'string' && attrs.description
					? `<span class="markdoc-bookmark-desc">${escapeHtml(attrs.description)}</span>`
					: '';
			return `<a data-markdoc-tag="bookmark" class="markdoc-bookmark" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer nofollow"><span class="markdoc-bookmark-title">${escapeHtml(title)}</span>${description}<span class="markdoc-bookmark-url">${escapeHtml(safeUrl)}</span></a>`;
		}
		if (tag.name === 'math') {
			const latex = typeof attrs.latex === 'string' ? attrs.latex : '';
			if (!latex.trim()) return '';
			let renderedHtml: string;
			try {
				renderedHtml = katex.renderToString(latex, {
					throwOnError: false,
					displayMode: Boolean(attrs.display)
				});
			} catch {
				return '';
			}
			const displayClass = attrs.display ? ' markdoc-math--display' : '';
			return `<span data-markdoc-tag="math" class="markdoc-math${displayClass}">${renderedHtml}</span>`;
		}
		if (tag.name === 'toc') {
			const headings = buildNotebookOutline(currentStaticHtmlCells).filter(
				(e) => e.kind === 'heading'
			);
			if (!headings.length) return '';
			const items = headings
				.map(
					(h) =>
						`<li style="padding-left:${(h.level - 1) * 0.85}rem"><a href="#${escapeHtml(h.anchorId ?? '')}">${escapeHtml(h.label)}</a></li>`
				)
				.join('');
			return `<nav data-markdoc-tag="toc" class="markdoc-toc"><p class="markdoc-toc-title">Contents</p><ul>${items}</ul></nav>`;
		}

		// Keep custom/unknown wrappers so exported HTML preserves layout semantics.
		return renderGenericMarkdocWrapper(tag.name, childrenHtml);
	}

	return escapeHtml(String(node));
}

/** Cells for the notebook currently being exported, set by `renderMarkdocCellToStaticHtml`.
 * `{% toc %}` needs the full notebook (not just this markdown cell's variables) to build its
 * heading list, and threading `cells` through every recursive render call would touch every
 * branch above for one tag — a module-scoped value read only by the `toc` branch is simpler.
 * Safe because rendering is synchronous and re-entrant only via the calls this module makes. */
let currentStaticHtmlCells: Cell[] = [];

/** Same per-cell heading-anchor scheme as MarkdocNode.svelte (headingSlugPrefix +
 * headingSlugTracker) — module-scoped for the same reason as `currentStaticHtmlCells`
 * above: threading it through every recursive call would touch every branch for one tag. */
let currentHeadingCellId = '';
let currentHeadingSlugTracker = new Set<string>();

export function renderMarkdocCellToStaticHtml(
	markdown: string,
	cells: Cell[],
	headingSlugPrefix = ''
): string {
	const { tree } = renderMarkdocCell(markdown, cells);
	const previousCells = currentStaticHtmlCells;
	const previousHeadingCellId = currentHeadingCellId;
	const previousHeadingSlugTracker = currentHeadingSlugTracker;
	currentStaticHtmlCells = cells;
	currentHeadingCellId = headingSlugPrefix;
	currentHeadingSlugTracker = new Set<string>();
	try {
		return tree.map((n) => renderRenderableToStaticHtml(n)).join('\n');
	} finally {
		currentStaticHtmlCells = previousCells;
		currentHeadingCellId = previousHeadingCellId;
		currentHeadingSlugTracker = previousHeadingSlugTracker;
	}
}
