import { chromium } from '@playwright/test';

const allErrors = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on('pageerror', (err) => allErrors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') allErrors.push('[console.error] ' + msg.text()); });

await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.waitForTimeout(2000);

await page.locator('.monaco-editor').first().click();
await page.keyboard.press('Meta+A');
const sql = "SELECT 'Jan' AS month, 'A' AS grp, 10 AS val UNION ALL SELECT 'Feb','A',25 UNION ALL SELECT 'Mar','A',15 UNION ALL SELECT 'Jan','B',30 UNION ALL SELECT 'Feb','B',22 UNION ALL SELECT 'Mar','B',40";
await page.keyboard.type(sql, { delay: 3 });
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(1500);

await page.locator('button:has-text("Chart")').click();
await page.waitForTimeout(500);
await page.locator('button[title^="Heatmap"]').first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/heatmap-2.png' });

console.log('ERRORS:', JSON.stringify(allErrors));
await browser.close();
