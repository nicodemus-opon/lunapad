import { chromium } from '@playwright/test';

const APP_URL = 'http://127.0.0.1:4216/';

const csvConfigs = [
	{
		path: '/Users/niconico/Downloads/fintech_transactions.csv',
		table: 'fintech_transactions',
		queries: ['amount usd by month', 'fraud rate by payment method']
	},
	{
		path: '/Users/niconico/Downloads/school_attendance.csv',
		table: 'school_attendance',
		queries: ['attendance by month', 'math score by grade']
	},
	{
		path: '/Users/niconico/Downloads/support_tickets.csv',
		table: 'support_tickets',
		queries: ['resolution hours by month', 'csat score by priority']
	},
	{
		path: '/Users/niconico/Downloads/climate_readings.csv',
		table: 'climate_readings',
		queries: ['temperature by month', 'air quality by region']
	},
	{
		path: '/Users/niconico/Downloads/manufacturing_batches.csv',
		table: 'manufacturing_batches',
		queries: ['units produced by month', 'defect rate by plant']
	},
	{
		path: '/Users/niconico/Downloads/real_estate_leases.csv',
		table: 'real_estate_leases',
		queries: ['rent usd by city', 'leases by month']
	},
	{
		path: '/Users/niconico/Downloads/saas_subscriptions.csv',
		table: 'saas_subscriptions',
		queries: ['mrr by month', 'churn risk by industry']
	},
	{
		path: '/Users/niconico/Downloads/logistics_shipments.csv',
		table: 'logistics_shipments',
		queries: ['distance km by mode', 'on-time delivery by month']
	},
	{
		path: '/Users/niconico/Downloads/hospital_visits.csv',
		table: 'hospital_visits',
		queries: ['cost usd by department', 'wait minutes by triage level']
	},
	{
		path: '/Users/niconico/Downloads/ecommerce_orders.csv',
		table: 'ecommerce_orders',
		queries: ['units by month', 'returns by channel']
	}
];

function pickGap(record) {
	const q = record.query.toLowerCase();
	const top = record.topResult.toLowerCase();
	if (q.includes('by month') && !/month|monthly|trend|time|date/.test(top)) {
		return 'Temporal intent not reflected in top result';
	}
	if (q.includes('by ') && !/group by|value counts|trend|by /.test(top)) {
		return 'Grouping intent not reflected in top result';
	}
	if (record.lanes.length === 0) {
		return 'No lanes returned for query';
	}
	return '';
}

async function setFromTable(page, tableName) {
	const fromCard = page.locator('[data-testid="stage-card"][data-stage-type="from"]').first();
	await fromCard.locator('[data-testid="stage-header"]').click();

	const trigger = fromCard.getByRole('button').first();
	await trigger.click();

	const sourceInput = page.getByPlaceholder('schema.table or cell_output').first();
	await sourceInput.fill(tableName);
	await sourceInput.press('Tab');
	await page.keyboard.press('Escape');
}

async function ensureGuiMode(page) {
	const guiButton = page
		.locator('.notebook-cell')
		.first()
		.getByRole('button', { name: /Switch to GUI mode/i })
		.first();
	if (await guiButton.count()) {
		await guiButton.click({ force: true });
	}
	await page.waitForSelector('[data-testid="stage-card"]', { timeout: 10000 });
}

async function openPalette(page) {
	const firstStageCard = page.locator('[data-testid="stage-card"]').first();
	await firstStageCard.focus();
	await page.keyboard.press('a');
	await page
		.getByPlaceholder('Prompt or search stages, templates, and columns...')
		.waitFor({ timeout: 5000 });
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const results = [];

	await page.goto(APP_URL);
	await page.waitForSelector('.notebook-cell', { timeout: 15000 });
	await ensureGuiMode(page);

	for (const config of csvConfigs) {
		await page.setInputFiles('input[type="file"][accept=".csv"]', config.path);
		await page.waitForTimeout(700);

		await setFromTable(page, config.table);
		await page.waitForTimeout(200);
		await openPalette(page);

		const queryInput = page.getByPlaceholder('Prompt or search stages, templates, and columns...');

		for (const query of config.queries) {
			await queryInput.fill(query);
			await page.waitForTimeout(250);

			const lanes = (await page.locator('.chip-lane-heading').allTextContents()).map((v) =>
				v.trim()
			);
			const topResult = (
				await page
					.locator('section button')
					.first()
					.innerText()
					.catch(() => '')
			)
				.replace(/\s+/g, ' ')
				.trim();

			const record = {
				dataset: config.table,
				query,
				firstLane: lanes[0] ?? '',
				lanes,
				topResult,
				gap: ''
			};
			record.gap = pickGap(record);
			results.push(record);
		}

		await page.keyboard.press('Escape');
		await page.waitForTimeout(150);
	}

	console.log(JSON.stringify(results, null, 2));
	await browser.close();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
