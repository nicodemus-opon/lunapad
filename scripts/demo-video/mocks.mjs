// Mock server-backed features so the full walkthrough can be recorded without a real
// Postgres/AI backend — these give the AI/Share/Sites/Review beats a real-looking
// response to react to instead of stalling on a network call that has nowhere to land.
export async function installFullWalkthroughMocks(page) {
	await page.route('**/api/ai/chat', async (route) => {
		const sse = [
			`data: ${JSON.stringify({ type: 'text', text: 'Here is an updated SQL model that adds a rounded month-over-month percentage column.' })}\n\n`,
			`data: ${JSON.stringify({
				type: 'tool_call',
				tool: 'edit_cell',
				args: {
					outputName: 'growth_analysis',
					code: `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
WHERE total_revenue > 0
ORDER BY month`
				}
			})}\n\n`,
			`data: ${JSON.stringify({ type: 'done' })}\n\n`
		].join('');
		await route.fulfill({
			status: 200,
			contentType: 'text/event-stream',
			body: sse
		});
	});

	await page.route('**/api/shares**', async (route) => {
		const url = route.request().url();
		if (url.includes('/check-slug')) {
			return route.fulfill({ json: { available: true } });
		}
		if (route.request().method() === 'POST') {
			return route.fulfill({
				json: {
					token: 'demo-share-token',
					slug: 'sales-analytics',
					currentVersion: 1,
					lastUpdatedAt: new Date().toISOString()
				}
			});
		}
		if (url.includes('/versions')) {
			return route.fulfill({
				json: {
					versions: [
						{
							version: 1,
							notebookName: 'Sales Analytics Demo',
							createdAt: new Date().toISOString()
						}
					]
				}
			});
		}
		return route.fulfill({
			json: {
				token: 'demo-share-token',
				slug: 'sales-analytics',
				notebookName: 'Sales Analytics Demo',
				currentVersion: 1,
				pollIntervalSeconds: 300,
				requireAuth: false
			}
		});
	});

	await page.route('**/api/sites**', async (route) => {
		if (route.request().method() === 'GET') {
			return route.fulfill({
				json: {
					sites: [
						{
							id: 'site-1',
							slug: 'sales',
							title: 'Sales Analytics',
							pages: [
								{
									id: 'page-1',
									pageSlug: 'overview',
									navLabel: 'Overview',
									shareToken: 'demo-share-token'
								}
							]
						}
					]
				}
			});
		}
		return route.fulfill({ json: { ok: true } });
	});

	await page.route('**/api/comments/**', async (route) => {
		const method = route.request().method();
		if (method === 'GET') {
			if (route.request().url().includes('/inbox')) {
				return route.fulfill({ json: { threads: [], unreadCount: 1 } });
			}
			if (route.request().url().includes('/counts')) {
				return route.fulfill({ json: { counts: {} } });
			}
			return route.fulfill({
				json: {
					thread: {
						id: 'thread-1',
						cellId: 'cell-1',
						status: 'open',
						notebookId: 'nb-1'
					},
					comments: [
						{
							id: 'c1',
							body: 'Can we add West region to the default filter?',
							authorName: 'Alex',
							createdAt: new Date().toISOString()
						}
					]
				}
			});
		}
		return route.fulfill({ json: { ok: true } });
	});

	await page.route('**/api/team/users**', async (route) => {
		await route.fulfill({
			json: {
				users: [
					{ id: 'u1', name: 'Alex', email: 'alex@example.com' },
					{ id: 'u2', name: 'Sam', email: 'sam@example.com' }
				]
			}
		});
	});
}
