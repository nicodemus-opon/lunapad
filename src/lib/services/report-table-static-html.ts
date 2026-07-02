import { buildReportTableModel, type ReportTableModel } from '$lib/services/report-table-model';
import { formatCellForDisplay } from '$lib/services/report-table-format';
import type { ColumnFormat } from '$lib/services/column-format';

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeHtmlAttr(s: string): string {
	return escapeHtml(s);
}

function isNullish(v: unknown): boolean {
	return v === null || v === undefined;
}

function formatCellHtml(value: unknown, format: ColumnFormat, colId: string): string {
	const { text, categorySeed } = formatCellForDisplay(value, format);

	switch (format.kind) {
		case 'boolean':
			return `<span class="mono">${escapeHtml(text)}</span>`;
		case 'id':
			return `<span class="mono muted">${escapeHtml(text)}</span>`;
		case 'email':
			return `<a class="link mono" href="mailto:${escapeHtmlAttr(
				String(value)
			)}">${escapeHtml(text)}</a>`;
		case 'url':
			return `<a class="link mono" href="${escapeHtmlAttr(String(value))}" rel="noopener noreferrer" target="_blank">${escapeHtml(
				text
			)}</a>`;
		case 'date':
		case 'datetime':
		case 'number':
		case 'currency':
		case 'percentage':
			return `<span class="mono tabular">${escapeHtml(text)}</span>`;
		case 'category': {
			const seed = categorySeed ?? 0;
			const idx = seed + 1;
			return `<span class="category"><span class="tag-dot" style="background: var(--tag-${idx})"></span><span class="truncate">${escapeHtml(
				text
			)}</span></span>`;
		}
		case 'text':
		default:
			return `<span>${escapeHtml(text)}</span>`;
	}
}

export function renderReportTableToStaticHtml(
	rows: Record<string, unknown>[],
	columns: string[],
	options: {
		name?: string;
		maxRows?: number;
		truncated?: boolean;
		columnFormatOverrides?: Record<string, ColumnFormat>;
	} = {}
): string {
	const { name, maxRows = 500, truncated = false, columnFormatOverrides } = options;
	const model: ReportTableModel = buildReportTableModel(rows, columns, {
		name,
		formatOverrides: columnFormatOverrides
	});

	const visibleRows = rows.slice(0, maxRows);

	const headerHtml = model.columns
		.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${escapeHtml(c.label)}</th>`)
		.join('');

	const bodyHtml = visibleRows
		.map((r) => {
			const tds = model.columns
				.map((c) => {
					const v = r[c.id];
					if (isNullish(v)) return `<td class="${c.align === 'right' ? 'num' : ''} muted">—</td>`;
					return `<td class="${c.align === 'right' ? 'num' : ''}">${formatCellHtml(
						v,
						c.format,
						c.id
					)}</td>`;
				})
				.join('');
			return `<tr>${tds}</tr>`;
		})
		.join('');

	const footerNote = truncated ? `<div class="table-note">· first ${visibleRows.length.toLocaleString()} rows</div>` : '';

	return `
<div class="table-wrap">
	<table class="report-table">
		<thead>
			<tr>${headerHtml}</tr>
		</thead>
		<tbody>
			${bodyHtml}
		</tbody>
	</table>
	${footerNote}
</div>
`.trim();
}

