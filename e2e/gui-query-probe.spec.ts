import { test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const OUTPUT_PATH = '/tmp/gui_query_probe_results.json';

const FULL_QUERY = `from invoices
filter invoice_date >= @1970-01-16
derive {
  transaction_fees = 0.8,
  income = total - transaction_fees
}
filter income > 1
group customer_id (
  aggregate {
    average total,
    sum_income = sum income,
    ct = count total,
  }
)
sort {-sum_income}
take 10
join c=customers (==customer_id)
derive name = f"{c.last_name}, {c.first_name}"
select {
  c.customer_id, name, sum_income
}
derive db_version = s"version()"`;

const csvConfigs = [
  { path: '/Users/niconico/Downloads/fintech_transactions.csv', table: 'fintech_transactions', queries: ['amount usd by month', 'fraud rate by payment method'] },
  { path: '/Users/niconico/Downloads/school_attendance.csv', table: 'school_attendance', queries: ['attendance by month', 'math score by grade'] },
  { path: '/Users/niconico/Downloads/support_tickets.csv', table: 'support_tickets', queries: ['resolution hours by month', 'csat score by priority'] },
  { path: '/Users/niconico/Downloads/climate_readings.csv', table: 'climate_readings', queries: ['temperature by month', 'air quality by region'] },
  { path: '/Users/niconico/Downloads/manufacturing_batches.csv', table: 'manufacturing_batches', queries: ['units produced by month', 'defect rate by plant'] },
  { path: '/Users/niconico/Downloads/real_estate_leases.csv', table: 'real_estate_leases', queries: ['rent usd by city', 'leases by month'] },
  { path: '/Users/niconico/Downloads/saas_subscriptions.csv', table: 'saas_subscriptions', queries: ['mrr by month', 'churn risk by industry'] },
  { path: '/Users/niconico/Downloads/logistics_shipments.csv', table: 'logistics_shipments', queries: ['distance km by mode', 'on-time delivery by month'] },
  { path: '/Users/niconico/Downloads/hospital_visits.csv', table: 'hospital_visits', queries: ['cost usd by department', 'wait minutes by triage level'] },
  {
    path: '/Users/niconico/Downloads/ecommerce_orders.csv',
    table: 'ecommerce_orders',
    queries: [
      'units by month',
      'returns by channel',
      'monthly return rate by channel where region is west',
      'top 5 customer_name by units where returned == true',
      'compare discount_pct and shipping_days by product_category',
      'find outlier shipping_days by channel'
    ]
  }
] as const;

type ProbeRecord = {
  dataset: string;
  query: string;
  firstLane: string;
  lanes: string[];
  topResult: string;
  error?: string;
};

async function gotoWithCode(page: Page, code: string) {
  await page.addInitScript((prql) => {
    const notebookId = 'test-nb-probe';
    const cellId = 'test-cell-probe';
    const storageData = {
      notebooks: [{
        id: notebookId,
        name: 'Probe Notebook',
        folderId: null,
        cells: [{
          id: cellId,
          outputName: 'result1',
          code: prql,
          status: 'idle',
          result: null,
          errors: [],
          compiledSQL: null,
          executionMs: null,
          guiStages: [{ type: 'from', table: '' }],
          editMode: 'prql',
          resultViewMode: 'table',
          resultChartConfig: null
        }]
      }],
      folders: [],
      openNotebookTabIds: [notebookId],
      expandedNotebookFolderIds: [],
      sidebarSectionsExpanded: { notebooks: true, tables: true },
      activeTabId: notebookId,
      openResultTabs: [],
      openExtraTabs: [],
      tables: [],
      theme: 'system'
    };
    localStorage.setItem('lunapad_notebook', JSON.stringify(storageData));
  }, code);

  await page.goto('/');
  await page.waitForSelector('.code-editor .monaco-editor', { timeout: 10000 });
}

async function switchToGuiMode(page: Page) {
  const guiButton = page.locator('.notebook-cell').first().getByRole('button', { name: 'Visual', exact: true }).first();
  if (await guiButton.count()) {
    await guiButton.click({ force: true });
  }
  await page.waitForSelector('[data-testid="stage-card"]', { timeout: 10000 });
}

async function uploadCsv(page: Page, path: string) {
  await page.setInputFiles('input[type="file"][accept=".csv"]', path);
  await page.waitForTimeout(900);
}

async function setFromTable(page: Page, table: string) {
  await page.waitForFunction(() => !!(window as any).__testHelpers, { timeout: 5000 });
  await page.evaluate(async (tableName: string) => {
    const h = (window as any).__testHelpers;
    const cell = h.getCells?.()[0];
    if (!cell) return;
    h.setEditMode(cell.id, 'prql');
    h.updateCellCode(cell.id, `from ${tableName}`);
    await h.tick();
  }, table);
  await page.waitForSelector('.code-editor .monaco-editor', { timeout: 5000 });
  await switchToGuiMode(page);
}

async function openPalette(page: Page) {
  await page.locator('[data-testid="stage-card"]').first().focus();
  await page.keyboard.press('a');
  await page.getByPlaceholder(/Prompt or search stages/i).waitFor({ timeout: 5000 });
}

test('probe add-stage query signatures across provided CSVs', async ({ page }) => {
  test.setTimeout(180000);
  const records: ProbeRecord[] = [];

  await gotoWithCode(page, FULL_QUERY);
  await switchToGuiMode(page);

  for (const cfg of csvConfigs) {
    await uploadCsv(page, cfg.path);
    await setFromTable(page, cfg.table);
    await openPalette(page);
    const queryInput = page.getByPlaceholder(/Prompt or search stages/i);

    for (const query of cfg.queries) {
      try {
        await queryInput.fill(query);
        await page.waitForTimeout(800);

        const lanes = (await page.locator('.chip-lane-heading').allTextContents()).map((v) => v.trim());
        const topResult = (await page.locator('section button').first().innerText()).replace(/\s+/g, ' ').trim();

        records.push({
          dataset: cfg.table,
          query,
          firstLane: lanes[0] ?? '',
          lanes,
          topResult
        });
      } catch (error) {
        records.push({
          dataset: cfg.table,
          query,
          firstLane: '',
          lanes: [],
          topResult: '',
          error: String(error)
        });
      }
    }

    await page.keyboard.press('Escape');
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(records, null, 2), 'utf8');
  console.log(`Wrote probe results to ${OUTPUT_PATH}`);
});
