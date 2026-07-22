import type { RequestHandler } from './$types';
import { getShareByTokenOrSlug, toPublicShareView } from '$lib/server/shared-reports';
import { isShareExpired } from '$lib/server/share-run';
import { requireSharesRead } from '$lib/server/share-guards';
import { getOrganizationTheme } from '$lib/server/tenancy';
import type { Cell } from '$lib/stores/notebook.svelte';
import {
	renderMarkdocCellToStaticHtml,
	highlightCodeToStaticHtml
} from '$lib/services/report-markdoc-static-html';
import { renderReportTableToStaticHtml } from '$lib/services/report-table-static-html';
import { shouldHideQueryCell } from '$lib/services/filter-frozen';
import { extractReportFilters } from '$lib/services/report-filters';
import katexCss from 'katex/dist/katex.min.css?raw';

// Fallback token values for exports with no workspace brand theme configured —
// a workspace brand theme's `light` tokens (src/lib/types/theme.ts) override
// these by key, so an export always reflects the org's actual brand colors.
const DEFAULT_EXPORT_TOKENS: Record<string, string> = {
	'--background': '#ffffff',
	'--foreground': '#171717',
	'--muted-foreground': '#5f6368',
	'--border': '#d9d9d9',
	'--muted': '#f3f4f4',
	'--primary': '#0f7490',
	'--success': '#15803d',
	'--warning': '#b45309',
	'--destructive': '#dc2626',
	'--chart-1': '#0f7490',
	'--chart-2': '#15803d',
	'--chart-3': '#b45309',
	'--chart-4': '#7c3aed',
	'--chart-5': '#dc2626',
	'--table-positive': 'oklch(0.73 0.17 150)',
	'--table-negative': 'oklch(0.67 0.2 25)',
	'--tag-1': 'oklch(0.52 0.185 25)',
	'--tag-2': 'oklch(0.53 0.15 70)',
	'--tag-3': 'oklch(0.51 0.14 140)',
	'--tag-4': 'oklch(0.52 0.13 195)',
	'--tag-5': 'oklch(0.49 0.17 255)',
	'--tag-6': 'oklch(0.49 0.19 300)',
	'--tag-7': 'oklch(0.52 0.19 340)',
	'--tag-8': 'oklch(0.45 0.03 60)'
};

// Same idea, applied when the reader flips the bottom-of-page theme switcher to
// dark — mirrors layout.css's `.dark` block so the export's dark mode matches the
// app's rather than inventing its own palette.
const DEFAULT_EXPORT_DARK_TOKENS: Record<string, string> = {
	'--background': 'oklch(0.2679 0.0036 106.6427)',
	'--foreground': 'oklch(0.8074 0.0142 93.0137)',
	'--muted-foreground': 'oklch(0.7713 0.0169 99.0657)',
	'--border': 'oklch(0.3618 0.0101 106.8928)',
	'--muted': 'oklch(0.2213 0.0038 106.707)',
	'--primary': 'oklch(0.901 0.058 230.902)',
	'--success': 'oklch(0.746 0.16 232.661)',
	'--warning': 'oklch(0.828 0.189 84.429)',
	'--destructive': 'oklch(0.704 0.191 22.216)',
	'--chart-1': 'oklch(0.746 0.16 232.661)',
	'--chart-2': 'oklch(0.811 0.111 293.571)',
	'--chart-3': 'oklch(0.923 0.003 48.717)',
	'--chart-4': 'oklch(0.554 0.046 257.417)',
	'--chart-5': 'oklch(0.956 0.045 203.388)',
	'--table-positive': 'oklch(0.73 0.17 150)',
	'--table-negative': 'oklch(0.67 0.2 25)',
	'--tag-1': 'oklch(0.76 0.16 25)',
	'--tag-2': 'oklch(0.78 0.14 70)',
	'--tag-3': 'oklch(0.77 0.13 140)',
	'--tag-4': 'oklch(0.78 0.12 195)',
	'--tag-5': 'oklch(0.77 0.14 255)',
	'--tag-6': 'oklch(0.77 0.15 300)',
	'--tag-7': 'oklch(0.78 0.16 340)',
	'--tag-8': 'oklch(0.77 0.015 60)'
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const denied = requireSharesRead(locals);
	if (denied) return new Response(denied.error, { status: denied.status });

	const share = await getShareByTokenOrSlug(params.token);
	if (!share || share.revoked) return new Response('Not found', { status: 404 });
	if (isShareExpired(share)) return new Response('This report link has expired.', { status: 410 });

	const view = toPublicShareView(share);
	const brandTheme = await getOrganizationTheme(share.orgId).catch(() => null);
	const exportTokens = { ...DEFAULT_EXPORT_TOKENS, ...(brandTheme?.light ?? {}) };
	const rootCss = Object.entries(exportTokens)
		.map(([key, value]) => `      ${key}: ${value};`)
		.join('\n');
	const darkExportTokens = { ...DEFAULT_EXPORT_DARK_TOKENS, ...(brandTheme?.dark ?? {}) };
	const darkRootCss = Object.entries(darkExportTokens)
		.map(([key, value]) => `      ${key}: ${value};`)
		.join('\n');

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

	// The live report page consolidates every {% filter %} tag into one interactive
	// bar above the cells (ReportFilterBar.svelte) and suppresses the tags inline —
	// a static file can't run that interactivity, but showing nothing where the live
	// page shows a prominent filter bar is its own gap. Show what's filterable and
	// its default, read-only, instead of silently dropping the bar.
	const filterDefs = extractReportFilters(
		view.cells.filter((c) => c.cellType === 'markdown' && c.markdown).map((c) => c.markdown!)
	);
	const filterBarHtml =
		filterDefs.length > 0
			? `<div class="report-filter-bar"><span class="report-filter-bar-title">Filters (static — open the live report to change)</span>${filterDefs
					.map(
						(f) =>
							`<span class="report-filter-chip"><span class="report-filter-chip-label">${escapeHtml(f.label ?? f.param)}</span><span class="report-filter-chip-value">${escapeHtml(f.defaultValue ?? 'All')}</span></span>`
					)
					.join('')}</div>`
			: '';

	const cellsHtml = view.cells
		.filter((cell) => !shouldHideQueryCell(cell))
		.map((cell) => {
			if (cell.cellType === 'markdown' && cell.markdown) {
				const mdHtml = renderMarkdocCellToStaticHtml(
					cell.markdown,
					markdocCells as unknown as Cell[],
					cell.id
				);
				return `<div class="cell"><div class="report-markdown">${mdHtml}</div></div>`;
			}

			if (cell.cellType === 'query' || cell.cellType === 'python') {
				const snap = frozenById.get(cell.id);
				const pythonOutput = cell.cellType === 'python' ? cell.pythonOutput : null;
				const pythonHtml = pythonOutput ? renderPythonOutputToStaticHtml(pythonOutput) : '';
				const highlightLang = cell.cellType === 'python' ? 'python' : cell.language;
				const codeHtml = cell.code
					? `<pre class="hljs-block"><code class="language-${escapeHtml(highlightLang)}">${highlightCodeToStaticHtml(cell.code, highlightLang)}</code></pre>`
					: '';
				if (!snap) {
					return pythonHtml || codeHtml
						? `<div class="cell">${codeHtml}${pythonHtml}</div>`
						: `<div class="cell"><em>No static result available.</em></div>`;
				}
				const truncated = snap.rows.length > 500;
				const tableHtml = renderReportTableToStaticHtml(snap.rows, snap.columns, {
					name: cell.outputName || 'result',
					maxRows: 500,
					truncated,
					columnFormatRules: cell.columnFormatRules ?? {}
				});
				return `<div class="cell">${codeHtml}${pythonHtml}${tableHtml}</div>`;
			}

			return `<div class="cell"></div>`;
		})
		.join('\n');

	// Inlined (not CDN-linked) so the export stays a single, offline-viewable file — same
	// self-contained philosophy as the rest of this shell. Only paid for when actually used.
	const needsKatex = cellsHtml.includes('markdoc-math');

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(view.notebookName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${needsKatex ? `<style>${katexCss}</style>` : ''}
  <style>
    :root {
${rootCss}
    }
    :root[data-theme='dark'] {
${darkRootCss}
    }
    * { box-sizing: border-box; }
    html { background: var(--background); }
    body { font-family: system-ui, sans-serif; max-width: 56rem; margin: 0 auto; padding: 2rem 1.5rem 5rem; color: var(--foreground); background: var(--background); overflow-wrap: anywhere; }
    body > h1 { font-size: 1.5rem; line-height: 1.15; margin: 0 0 0.5rem; }
    .cell { margin: 1.35rem 0; }
    .report-markdown { font-size: 0.95rem; line-height: 1.62; text-wrap: pretty; }
    .report-markdown p { margin: 0.45rem 0; }
    /* Matches markdown-surface.css's shared .report-markdown scale — the same rules the
       in-app Report View (.notebook-document-surface) renders with. Keep these two in
       sync by hand; this file can't import the app's CSS since it's a standalone
       downloaded document. */
    .report-markdown h1, .report-markdown h2, .report-markdown h3, .report-markdown h4, .report-markdown h5, .report-markdown h6 { color: var(--foreground); font-weight: 700; letter-spacing: 0; line-height: 1.18; text-transform: none; text-wrap: balance; }
    .report-markdown h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; margin: 1.45rem 0 0.7rem; }
    .report-markdown h2 { font-size: 1.35rem; font-weight: 760; margin: 1.35rem 0 0.55rem; }
    .report-markdown h3 { font-size: 1.08rem; font-weight: 700; margin: 1.05rem 0 0.45rem; }
    .report-markdown h4 { font-size: 0.95rem; font-weight: 680; margin: 0.9rem 0 0.35rem; }
    .report-markdown h5 { font-size: 0.86rem; font-weight: 660; color: color-mix(in oklab, var(--foreground) 88%, var(--muted-foreground)); margin: 0.8rem 0 0.3rem; }
    .report-markdown h6 { font-size: 0.78rem; font-weight: 650; color: var(--muted-foreground); margin: 0.75rem 0 0.25rem; }
    .report-markdown blockquote { margin: 0.65rem 0; padding: 0.5rem 0.65rem; border: 1px solid var(--border); border-radius: 0.15rem; background: color-mix(in oklab, var(--muted) 22%, transparent); color: color-mix(in oklab, var(--foreground) 88%, var(--muted-foreground)); font-size: 0.92em; font-style: normal; }
    .report-markdown blockquote > :first-child { margin-top: 0; }
    .report-markdown blockquote > :last-child { margin-bottom: 0; }
    .report-markdown hr { border: none; border-top: 1px solid var(--border); margin: 1.1rem 0; }
    .report-markdown :not(pre) > code { border: 1px solid color-mix(in oklab, var(--border) 85%, transparent); border-radius: 0.15rem; background: color-mix(in oklab, var(--muted) 30%, transparent); padding: 0.05rem 0.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.86em; font-weight: 500; }
    .report-markdown a:not(.markdoc-bookmark, .markdoc-embed-fallback) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; text-decoration-color: color-mix(in oklab, var(--primary) 45%, transparent); }
    .report-markdown ul:not([data-type='taskList']) { list-style-type: disc; padding-left: 1.35rem; margin: 0.35rem 0; }
    .report-markdown ol { list-style-type: decimal; padding-left: 1.35rem; margin: 0.35rem 0; font-variant-numeric: tabular-nums; }
    .report-markdown li { margin: 0.125rem 0; }
    .report-markdown img:not(.emoji) { max-width: 100%; border-radius: 0.15rem; border: 1px solid var(--border); background: color-mix(in oklab, var(--muted) 18%, transparent); margin: 0.45rem 0; }
    /* Exact hex values from the lunapad-light/lunapad-dark Monaco themes
       (src/lib/monaco/themes.ts) — code should look the same as it does in the
       editor, not derive from the (brand-customizable) app color tokens. */
    .hljs-block { margin: 0 0 0.5rem; padding: 0.75rem 1rem; border-radius: 0.35rem; background: #f3f1ea; color: #1f1e1b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
    .hljs-block code { background: none; padding: 0; border: none; font-family: inherit; font-size: inherit; }
    .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-tag { color: #2f6f9f; font-weight: 700; }
    .hljs-string, .hljs-attr { color: #58804f; }
    .hljs-number, .hljs-literal { color: #9c6b2e; }
    .hljs-comment, .hljs-quote, .hljs-meta { color: #8a8276; font-style: italic; }
    .hljs-title, .hljs-section, .hljs-name { color: #6a5b9e; }
    .hljs-variable, .hljs-template-variable { color: #1f1e1b; }
    .hljs-type, .hljs-class { color: #2e7d86; }
    :root[data-theme='dark'] .hljs-block { background: #1f1e1b; color: #c3c0b6; }
    :root[data-theme='dark'] .hljs-keyword, :root[data-theme='dark'] .hljs-selector-tag, :root[data-theme='dark'] .hljs-built_in, :root[data-theme='dark'] .hljs-tag { color: #7fb8dd; }
    :root[data-theme='dark'] .hljs-string, :root[data-theme='dark'] .hljs-attr { color: #a9c49a; }
    :root[data-theme='dark'] .hljs-number, :root[data-theme='dark'] .hljs-literal { color: #d4a972; }
    :root[data-theme='dark'] .hljs-comment, :root[data-theme='dark'] .hljs-quote, :root[data-theme='dark'] .hljs-meta { color: #8f8a7d; }
    :root[data-theme='dark'] .hljs-title, :root[data-theme='dark'] .hljs-section, :root[data-theme='dark'] .hljs-name { color: #b1a6d4; }
    :root[data-theme='dark'] .hljs-variable, :root[data-theme='dark'] .hljs-template-variable { color: #c3c0b6; }
    :root[data-theme='dark'] .hljs-type, :root[data-theme='dark'] .hljs-class { color: #92c4c4; }
    .markdoc-metric { display: inline-flex; flex-direction: column; gap: 0.1rem; margin: 0.3rem 0.6rem 0.3rem 0; }
    .markdoc-metric-value { font-size: 1.4rem; font-weight: 700; color: var(--markdoc-metric-accent, var(--foreground)); }
    .markdoc-metric-label { font-size: 0.75rem; color: var(--muted-foreground); }
    .markdoc-metric-delta { font-size: 0.75rem; font-weight: 600; }
    .markdoc-metric-delta--up { color: var(--success); }
    .markdoc-metric-delta--down { color: var(--destructive); }
    .markdoc-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; border: 1px solid var(--markdoc-badge-token, var(--border)); color: var(--markdoc-badge-token, var(--foreground)); font-size: 0.75rem; font-weight: 600; }
    .markdoc-progress { margin: 0.5rem 0; font-size: 0.8rem; }
    .markdoc-progress-label { margin-bottom: 0.25rem; color: var(--muted-foreground); }
    .markdoc-progress-track { height: 0.5rem; border-radius: 999px; background: var(--muted); overflow: hidden; }
    .markdoc-progress-fill { height: 100%; border-radius: 999px; }
    .markdoc-progress-value { margin-top: 0.2rem; font-size: 0.72rem; color: var(--muted-foreground); }
    .markdoc-chart-fallback { margin: 0.5rem 0; }
    .markdoc-chart-fallback-title { font-weight: 650; margin: 0 0 0.2rem; }
    .markdoc-chart-fallback-note { font-size: 0.78rem; color: var(--muted-foreground); margin: 0 0 0.4rem; font-style: italic; }
    .python-block { margin: 0 0 0.75rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; white-space: pre-wrap; overflow-x: auto; }
    .python-block-muted { background: var(--muted); color: var(--muted-foreground); }
    .python-block-error { background: color-mix(in oklab, var(--destructive) 10%, transparent); border-color: color-mix(in oklab, var(--destructive) 40%, transparent); color: var(--destructive); }
    .python-note { margin: 0 0 0.75rem; font-size: 0.8rem; color: var(--muted-foreground); }
    .report-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; table-layout: auto; }
    .table-wrap { width: 100%; overflow-x: auto; }
    .report-table th, .report-table td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; vertical-align: top; text-align: left; }
    .report-table th { background: var(--muted); font-weight: 600; }
    .report-table .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.8rem; }
    .tabular { font-variant-numeric: tabular-nums; }
    .muted { color: var(--muted-foreground); }
    .link { color: var(--primary); text-decoration: underline; }
    .category { display: inline-flex; align-items: center; gap: 0.35rem; }
    .tag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; transform: translateY(1px); }
    .truncate { max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
    .table-note { font-size: 0.72rem; opacity: 0.7; margin-top: 0.35rem; }
    .markdoc-video { max-width: 100%; max-height: 32rem; border-radius: 0.375rem; }
    .markdoc-embed { position: relative; width: 100%; padding-top: 56.25%; margin: 0.5rem 0; border-radius: 0.375rem; overflow: hidden; background: var(--muted); }
    .markdoc-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }
    .markdoc-embed-fallback, .markdoc-bookmark { display: block; padding: 0.5rem 0.65rem; border: 1px solid var(--border); border-radius: 0.375rem; margin: 0.5rem 0; }
    .markdoc-bookmark-title { display: block; font-weight: 600; }
    .markdoc-bookmark-desc { display: block; font-size: 0.8rem; color: var(--muted-foreground); }
    .markdoc-bookmark-url { display: block; font-size: 0.75rem; color: var(--muted-foreground); }
    .markdoc-math--display { display: block; margin: 0.5rem 0; overflow-x: auto; text-align: center; }
    .markdoc-toc { border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.45rem 0.6rem; margin: 0.55rem 0; font-size: 0.8rem; background: var(--muted); }
    .markdoc-toc-title { font-size: 0.68rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted-foreground); margin: 0 0 0.3rem; }
    .markdoc-toc ul { list-style: none; margin: 0; padding: 0; }
    .markdoc-toc li { list-style: none; margin: 0.08rem 0; line-height: 1.45; }
    .markdoc-toc li::marker { content: ''; }
    .markdoc-toc li:has(a:empty) { display: none; }
    .markdoc-callout { display: flex; gap: 0.45rem; align-items: flex-start; margin: 0.55rem 0; padding: 0.45rem 0.6rem; border-radius: 0.375rem; border: 1px solid; font-size: 0.9em; line-height: 1.5; }
    .markdoc-callout-icon::before { flex-shrink: 0; margin-top: 0.18rem; font-weight: 700; }
    .markdoc-callout-title { margin: 0 0 0.12rem; font-weight: 650; }
    .markdoc-callout-body > :first-child { margin-top: 0; }
    .markdoc-callout-body > :last-child { margin-bottom: 0; }
    .markdoc-callout--info { background: color-mix(in oklab, var(--chart-1) 8%, transparent); border-color: var(--chart-1); }
    .markdoc-callout--info .markdoc-callout-icon::before { content: "i"; color: var(--chart-1); }
    .markdoc-callout--success { background: color-mix(in oklab, var(--success) 8%, transparent); border-color: var(--success); }
    .markdoc-callout--success .markdoc-callout-icon::before { content: "\u2713"; color: var(--success); }
    .markdoc-callout--warning { background: color-mix(in oklab, var(--warning) 8%, transparent); border-color: var(--warning); }
    .markdoc-callout--warning .markdoc-callout-icon::before { content: "!"; color: var(--warning); }
    .markdoc-callout--error { background: color-mix(in oklab, var(--destructive) 8%, transparent); border-color: var(--destructive); }
    .markdoc-callout--error .markdoc-callout-icon::before { content: "\u2715"; color: var(--destructive); }
    .report-filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.6rem; border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.4rem 0.6rem; margin-bottom: 1.25rem; }
    .report-filter-bar-title { font-size: 0.68rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); flex: 0 0 100%; margin-bottom: 0.1rem; }
    .report-filter-chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: var(--muted); font-size: 0.78rem; }
    .report-filter-chip-label { font-weight: 600; color: var(--muted-foreground); }
    .report-filter-chip-value { font-weight: 500; }
    .markdoc-card { border: 1px solid var(--border); border-radius: 0.375rem; padding: 0.55rem 0.65rem; margin: 0.6rem 0; }
    .markdoc-card-title { font-weight: 650; margin: 0 0 0.32rem; }
    .markdoc-grid { display: grid; grid-template-columns: repeat(var(--markdoc-grid-cols, 3), minmax(0, 1fr)); gap: 0.75rem; margin: 0.65rem 0; }
    .markdoc-columns { display: flex; gap: 1rem; margin: 0.5rem 0; }
    .markdoc-column { flex: 1 1 0%; min-width: 0; }
    .markdoc-details { border: 1px solid var(--border); border-radius: 0.375rem; margin: 0.6rem 0; padding: 0.45rem 0.6rem; }
    .markdoc-details summary { cursor: pointer; font-weight: 650; }
    .markdoc-tabs { border: 1px solid var(--border); border-radius: 0.375rem; margin: 0.6rem 0; }
    .markdoc-tab { padding: 0.5rem 0.6rem; border-top: 1px solid var(--border); }
    .markdoc-tab:first-child { border-top: none; }
    .markdoc-tab h3 { margin: 0 0 0.4rem; font-size: 0.9rem; color: var(--foreground); }
    @media (max-width: 640px) {
      body { max-width: 100%; padding: 1rem; }
      .markdoc-grid { grid-template-columns: 1fr !important; }
      .markdoc-columns { flex-direction: column; gap: 0.5rem; }
      .report-table { min-width: 32rem; }
      pre, code, .hljs-block, .python-block { overflow-x: auto; white-space: pre-wrap; }
      .markdoc-video, .markdoc-embed, .markdoc-bookmark, .markdoc-toc, .markdoc-callout, .markdoc-card, .markdoc-details { max-width: 100%; }
    }
    .theme-switcher { position: fixed; left: 50%; bottom: 1.25rem; transform: translateX(-50%); display: inline-flex; gap: 0.15rem; padding: 0.2rem; border: 1px solid var(--border); border-radius: 999px; background: var(--background); box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1); z-index: 10; }
    .theme-switcher button { display: inline-flex; align-items: center; gap: 0.3rem; border: none; background: none; padding: 0.3rem 0.7rem; border-radius: 999px; font: inherit; font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); cursor: pointer; }
    .theme-switcher button[aria-pressed='true'] { background: var(--muted); color: var(--foreground); }
    @media print {
      .theme-switcher { display: none; }
    }
  </style>
  <script>
    // Applied before first paint to avoid a light-mode flash — mirrors the app's
    // own document.documentElement.classList theme toggle, but this file is a
    // standalone document so it keeps its own tiny copy instead of importing one.
    (function () {
      try {
        var saved = localStorage.getItem('lunapad-report-theme');
        var theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.dataset.theme = theme;
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <h1>${escapeHtml(view.notebookName)}</h1>
  ${view.description ? `<p>${escapeHtml(view.description)}</p>` : ''}
  <p><em>Static export — live cells are not refreshed in this file.</em></p>
  ${filterBarHtml}
  <div id="report-root">
    ${cellsHtml}
  </div>
  <div class="theme-switcher" role="group" aria-label="Theme">
    <button type="button" data-theme-choice="light" aria-pressed="false">Light</button>
    <button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button>
  </div>
  <script>
    (function () {
      var buttons = document.querySelectorAll('[data-theme-choice]');
      function sync() {
        var current = document.documentElement.dataset.theme || 'light';
        buttons.forEach(function (btn) {
          btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === current));
        });
      }
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var theme = btn.dataset.themeChoice;
          document.documentElement.dataset.theme = theme;
          try { localStorage.setItem('lunapad-report-theme', theme); } catch (e) {}
          sync();
        });
      });
      sync();
    })();
  </script>
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
		chunks.push(`<pre class="python-block python-block-muted">${escapeHtml(output.stdout)}</pre>`);
	}
	if (output.figures.length > 0) {
		chunks.push(
			`<p class="python-note">Interactive Python figures are available in the live report view only.</p>`
		);
	}
	return chunks.join('');
}
