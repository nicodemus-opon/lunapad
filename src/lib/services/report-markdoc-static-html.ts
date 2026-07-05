import Markdoc from '@markdoc/markdoc';
import type { RenderableTreeNode, Tag } from '@markdoc/markdoc';
import type { Cell } from '$lib/stores/notebook.svelte';
import { renderMarkdocCell } from '$lib/services/markdoc-interp';
import { textFromMarkdocChildren } from '$lib/services/notebook-outline';
import type { ColumnFormatKind } from '$lib/services/column-format';
import type { TableAggKind } from '$lib/services/report-table-summary';
import { renderReportTableToStaticHtml } from '$lib/services/report-table-static-html';
import { sanitizeUrl } from '$lib/services/safe-url';
import { pivotTable } from '$lib/services/report-table-pivot';
import { summarizeTable } from '$lib/services/report-table-summary';
import type {
	ColumnConditionalRules,
	ReportTableConditionalRule
} from '$lib/services/report-table-conditional-format';

const TagImpl = Markdoc.Tag;

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

// Standard HTML elements we emit verbatim (wrapping their rendered children).
const WRAP_TAGS = new Set([
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'ul',
	'ol',
	'li',
	'blockquote',
	'strong',
	'em',
	'del',
	'code',
	'pre',
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
		if (safeHref) parts.push(`href="${escapeHtml(safeHref)}"`);
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
			return `<aside data-markdoc-tag="callout" class="markdoc-callout markdoc-callout--${tone}">${childrenHtml}</aside>`;
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

		// Keep custom/unknown wrappers so exported HTML preserves layout semantics.
		return renderGenericMarkdocWrapper(tag.name, childrenHtml);
	}

	return escapeHtml(String(node));
}

export function renderMarkdocCellToStaticHtml(markdown: string, cells: Cell[]): string {
	const { tree } = renderMarkdocCell(markdown, cells);
	return tree.map((n) => renderRenderableToStaticHtml(n)).join('\n');
}
