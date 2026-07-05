import type { RequestHandler } from './$types';
import { getShareByTokenOrSlug, toPublicShareView } from '$lib/server/shared-reports';
import { isShareExpired } from '$lib/server/share-run';
import { requireSharesRead } from '$lib/server/share-guards';
import type { Cell } from '$lib/stores/notebook.svelte';
import { renderMarkdocCellToStaticHtml } from '$lib/services/report-markdoc-static-html';
import { renderReportTableToStaticHtml } from '$lib/services/report-table-static-html';

export const GET: RequestHandler = async ({ params, locals }) => {
	const denied = requireSharesRead(locals);
	if (denied) return new Response(denied.error, { status: denied.status });

	const share = await getShareByTokenOrSlug(params.token);
	if (!share || share.revoked) return new Response('Not found', { status: 404 });
	if (isShareExpired(share)) return new Response('This report link has expired.', { status: 410 });

	const view = toPublicShareView(share);

	// Markdoc uses `$outputName` variables backed by query results. The shared export
	// needs to provide those variables so `{% datatable %}` and other widgets render.
	const markdocCells = view.cells.map((c) => {
		if (c.cellType !== 'query' && c.cellType !== 'python') {
			return { cellType: c.cellType } as unknown as Cell;
		}
		return {
			cellType: c.cellType,
			outputName: c.outputName,
			result: c.frozenResult ?? null,
			resultChartConfig: c.resultChartConfig ?? null,
			columnFormatRules: c.columnFormatRules ?? {}
		} as unknown as Cell;
	});

	const frozenById = new Map(
		view.cells
			.filter((c) => (c.cellType === 'query' || c.cellType === 'python') && c.frozenResult)
			.map((c) => [c.id, c.frozenResult])
	);

	const cellsHtml = view.cells
		.map((cell) => {
			if (cell.cellType === 'markdown' && cell.markdown) {
				const mdHtml = renderMarkdocCellToStaticHtml(
					cell.markdown,
					markdocCells as unknown as Cell[]
				);
				return `<div class="cell"><div class="report-markdown">${mdHtml}</div></div>`;
			}

			if (cell.cellType === 'query' || cell.cellType === 'python') {
				const snap = frozenById.get(cell.id);
				const pythonOutput = cell.cellType === 'python' ? cell.pythonOutput : null;
				const pythonHtml = pythonOutput ? renderPythonOutputToStaticHtml(pythonOutput) : '';
				if (!snap) {
					return pythonHtml
						? `<div class="cell">${pythonHtml}</div>`
						: `<div class="cell"><em>No static result available.</em></div>`;
				}
				const truncated = snap.rows.length > 500;
				const tableHtml = renderReportTableToStaticHtml(snap.rows, snap.columns, {
					name: cell.outputName || 'result',
					maxRows: 500,
					truncated,
					columnFormatRules: cell.columnFormatRules ?? {}
				});
				return `<div class="cell">${pythonHtml}${tableHtml}</div>`;
			}

			return `<div class="cell"></div>`;
		})
		.join('\n');

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(view.notebookName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --table-positive: oklch(0.73 0.17 150);
      --table-negative: oklch(0.67 0.2 25);
      --tag-1: oklch(0.52 0.185 25);
      --tag-2: oklch(0.53 0.15 70);
      --tag-3: oklch(0.51 0.14 140);
      --tag-4: oklch(0.52 0.13 195);
      --tag-5: oklch(0.49 0.17 255);
      --tag-6: oklch(0.49 0.19 300);
      --tag-7: oklch(0.52 0.19 340);
      --tag-8: oklch(0.45 0.03 60);
    }
    body { font-family: system-ui, sans-serif; max-width: 56rem; margin: 0 auto; padding: 2rem 1.5rem; }
    h1 { font-size: 1.5rem; }
    .cell { margin: 1.5rem 0; }
    .report-markdown { font-size: 0.95rem; line-height: 1.7; }
    .report-markdown p { margin: 0 0 0.75rem; }
    .report-markdown h1, .report-markdown h2, .report-markdown h3, .report-markdown h4, .report-markdown h5, .report-markdown h6 { margin: 1.25rem 0 0.5rem; font-weight: 700; }
    .report-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.85em; }
    .python-block { margin: 0 0 0.75rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; white-space: pre-wrap; overflow-x: auto; }
    .python-block-muted { background: #f8fafc; color: #475569; }
    .python-block-error { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
    .python-note { margin: 0 0 0.75rem; font-size: 0.8rem; color: #6b7280; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; table-layout: auto; }
    .report-table th, .report-table td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; vertical-align: top; text-align: left; }
    .report-table th { background: #f5f5f5; font-weight: 600; }
    .report-table .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; }
    .tabular { font-variant-numeric: tabular-nums; }
    .muted { color: #6b7280; }
    .link { color: #2563eb; text-decoration: underline; }
    .category { display: inline-flex; align-items: center; gap: 0.35rem; }
    .tag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; transform: translateY(1px); }
    .truncate { max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
    .table-note { font-size: 0.72rem; opacity: 0.7; margin-top: 0.35rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(view.notebookName)}</h1>
  ${view.description ? `<p>${escapeHtml(view.description)}</p>` : ''}
  <p><em>Static export — live cells are not refreshed in this file.</em></p>
  <div id="report-root">
    ${cellsHtml}
  </div>
</body>
</html>`;

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Disposition': `attachment; filename="${view.notebookName.replace(/[^a-z0-9-_]+/gi, '-')}.html"`
		}
	});
};

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function renderPythonOutputToStaticHtml(
	output: NonNullable<ReturnType<typeof toPublicShareView>['cells'][number]['pythonOutput']>
): string {
	const chunks: string[] = [];
	if (output.error) {
		chunks.push(`<pre class="python-block python-block-error">${escapeHtml(output.error)}</pre>`);
	}
	if (output.stdout.trim()) {
		chunks.push(
			`<pre class="python-block python-block-muted">${escapeHtml(output.stdout)}</pre>`
		);
	}
	if (output.figures.length > 0) {
		chunks.push(
			`<p class="python-note">Interactive Python figures are available in the live report view only.</p>`
		);
	}
	return chunks.join('');
}
