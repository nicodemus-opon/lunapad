import type { RequestHandler } from './$types';
import { getShareByTokenOrSlug, toPublicShareView } from '$lib/server/shared-reports';
import { isShareExpired } from '$lib/server/share-run';
import { requireSharesRead } from '$lib/server/share-guards';

export const GET: RequestHandler = async ({ params, locals }) => {
	const denied = requireSharesRead(locals);
	if (denied) return new Response(denied.error, { status: denied.status });

	const share = await getShareByTokenOrSlug(params.token);
	if (!share || share.revoked) return new Response('Not found', { status: 404 });
	if (isShareExpired(share)) return new Response('This report link has expired.', { status: 410 });

	const view = toPublicShareView(share);
	const frozenJson = JSON.stringify(
		view.cells
			.filter((c) => !c.isLive && c.frozenResult)
			.map((c) => ({ id: c.id, result: c.frozenResult }))
	);

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(view.notebookName)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 56rem; margin: 0 auto; padding: 2rem 1.5rem; }
    h1 { font-size: 1.5rem; }
    .cell { margin: 1.5rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(view.notebookName)}</h1>
  ${view.description ? `<p>${escapeHtml(view.description)}</p>` : ''}
  <p><em>Static export — live cells are not refreshed in this file.</em></p>
  <div id="report-root"></div>
  <script>
    const data = ${JSON.stringify(view)};
    const frozen = ${frozenJson};
    const root = document.getElementById('report-root');
    for (const cell of data.cells) {
      const div = document.createElement('div');
      div.className = 'cell';
      if (cell.cellType === 'markdown' && cell.markdown) {
        div.innerHTML = '<pre>' + cell.markdown.replace(/</g, '&lt;') + '</pre>';
      } else if (cell.cellType === 'query') {
        const snap = frozen.find(f => f.id === cell.id);
        if (snap && snap.result) {
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const hr = document.createElement('tr');
          for (const col of snap.result.columns) {
            const th = document.createElement('th');
            th.textContent = col;
            hr.appendChild(th);
          }
          thead.appendChild(hr);
          table.appendChild(thead);
          const tbody = document.createElement('tbody');
          for (const row of snap.result.rows.slice(0, 500)) {
            const tr = document.createElement('tr');
            for (const col of snap.result.columns) {
              const td = document.createElement('td');
              td.textContent = row[col] == null ? '' : String(row[col]);
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          div.appendChild(table);
        }
      }
      root.appendChild(div);
    }
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
