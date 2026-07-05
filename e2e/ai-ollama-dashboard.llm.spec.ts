import { expect, test, type Page } from '@playwright/test';

const OLLAMA_BASE_URL = process.env.LLM_BASE_URL ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.LLM_MODEL ?? 'gemma4:12b-mlx';

async function hasOllamaModel(): Promise<boolean> {
	try {
		const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`, {
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) return false;
		const data = (await res.json()) as { models?: Array<{ name?: string }> };
		return (data.models ?? []).some((model) => model.name === OLLAMA_MODEL);
	} catch {
		return false;
	}
}

async function openFreshWorkspace(page: Page) {
	await page.route('**/api/workspace/load', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ data: null, updatedAt: null, updatedBy: null })
		});
	});
	await page.route('**/api/workspace/save', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ updatedAt: new Date().toISOString(), updatedBy: null })
		});
	});
	await page.route('**/api/account/settings', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				settings: {
					llmConfig: {
						provider: 'ollama',
						baseUrl: OLLAMA_BASE_URL,
						model: OLLAMA_MODEL
					}
				}
			})
		});
	});
	await page.addInitScript(() => {
		localStorage.clear();
		localStorage.setItem('lunapad_welcome_seen', '1');
	});
	await page.goto('/');
	await page.waitForFunction(() => Boolean((window as { __testHelpers?: unknown }).__testHelpers), {
		timeout: 60_000
	});
	await page.evaluate(async () => {
		const helpers = (window as unknown as {
			__testHelpers: {
				bootstrapDemoNotebook: (opts?: {
					runCells?: boolean;
					replaceIfExists?: boolean;
				}) => Promise<void>;
			};
		}).__testHelpers;
		await helpers.bootstrapDemoNotebook({ runCells: true, replaceIfExists: true });
	});
	await expect(page.getByRole('heading', { name: 'Sales Analytics Demo' })).toBeVisible({
		timeout: 60_000
	});
}

test.describe('Ollama AI dashboard smoke', () => {
	test('builds a Markdoc dashboard through the AI panel', async ({ page }) => {
		test.skip(
			!(await hasOllamaModel()),
			`Ollama model unavailable at ${OLLAMA_BASE_URL}: ${OLLAMA_MODEL}`
		);

		await openFreshWorkspace(page);
		await page.getByTestId('ai-toggle').click();
		await page.getByTestId('ai-input').fill(
			'/dashboard Build a board-ready revenue dashboard from the existing demo cells with monthly trend, region performance, top products, quota progress, and findings. Use live refs only.'
		);
		await page.getByTestId('ai-send').click();

		await page.waitForFunction(
			() => {
				const helpers = (window as unknown as {
					__testHelpers: {
						getCells: () => Array<{ cellType: string; markdown?: string; outputName?: string }>;
					};
				}).__testHelpers;
				return helpers.getCells().some((cell) => {
					if (cell.cellType !== 'markdown') return false;
					const md = cell.markdown ?? '';
					return (
						/\{%\s*(grid|metric|chart|tabs|progress)\b/i.test(md) &&
						/\$(monthly_revenue|region_performance|top_products|quota_attainment)\b/.test(md) &&
						!/\$cell\b|\$unicorn_revenue\b|create_dashboard|add_dashboard_block/i.test(md)
					);
				});
			},
			undefined,
			{ timeout: 300_000 }
		);

		const dashboardMarkdown = await page.evaluate(() => {
			const helpers = (window as unknown as {
				__testHelpers: {
					getCells: () => Array<{ cellType: string; markdown?: string; outputName?: string }>;
				};
			}).__testHelpers;
			return (
				helpers
					.getCells()
					.filter((cell) => cell.cellType === 'markdown')
					.map((cell) => cell.markdown ?? '')
					.find((markdown) => /\{%\s*(grid|metric|chart|tabs|progress)\b/i.test(markdown)) ??
				''
			);
		});

		expect(dashboardMarkdown).toMatch(/\{%\s*(grid|metric|chart|tabs|progress)\b/i);
		expect(dashboardMarkdown).not.toMatch(/\$cell\b|\$unicorn_revenue\b|create_dashboard/i);
		await expect(page.getByTestId('ai-panel')).not.toContainText(/Model returned an empty response/i);
	});
});
