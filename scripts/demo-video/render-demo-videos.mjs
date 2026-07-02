import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT = path.resolve('artifacts/demo-videos');
const FRAME_ROOT = path.join(OUT, 'rendered-frames');
fs.mkdirSync(FRAME_ROOT, { recursive: true });

const W = 1920;
const H = 1080;

function esc(s) {
	return String(s)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function wrap(text, max = 58) {
	const words = String(text).split(/\s+/);
	const lines = [];
	let line = '';
	for (const word of words) {
		if ((line + ' ' + word).trim().length > max) {
			if (line) lines.push(line);
			line = word;
		} else {
			line = `${line} ${word}`.trim();
		}
	}
	if (line) lines.push(line);
	return lines;
}

function textBlock(lines, x, y, size = 34, color = '#e2e8f0', weight = 500, gap = 1.35) {
	return lines
		.flatMap((line, i) =>
			wrap(line, 62).map(
				(part, j) =>
					`<text x="${x}" y="${y + (i + j) * size * gap}" fill="${color}" font-size="${size}" font-weight="${weight}">${esc(part)}</text>`
			)
		)
		.join('\n');
}

function codeBlock(code, x, y) {
	return `<rect x="${x}" y="${y}" width="820" height="310" rx="18" fill="#0f172a" stroke="#334155"/>
${String(code)
	.split('\n')
	.slice(0, 11)
	.map(
		(line, i) =>
			`<text x="${x + 28}" y="${y + 48 + i * 24}" fill="#cbd5e1" font-size="20" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${esc(line)}</text>`
	)
	.join('\n')}`;
}

function frameSvg(frame) {
	const bullets = frame.bullets ?? [];
	const code = frame.code ? codeBlock(frame.code, 980, 310) : '';
	const stageCards = (frame.stages ?? [])
		.map(
			(stage, i) =>
				`<rect x="${990 + (i % 2) * 380}" y="${320 + Math.floor(i / 2) * 96}" width="330" height="66" rx="14" fill="#f8fafc" stroke="#cbd5e1"/>
<text x="${1014 + (i % 2) * 380}" y="${361 + Math.floor(i / 2) * 96}" fill="#0f172a" font-size="24" font-weight="650">${esc(stage)}</text>`
		)
		.join('\n');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#020617"/>
<rect x="52" y="52" width="1816" height="976" rx="34" fill="#0b1120" stroke="#1e293b"/>
<rect x="88" y="88" width="1744" height="74" rx="18" fill="#111827"/>
<circle cx="126" cy="125" r="11" fill="#ef4444"/><circle cx="160" cy="125" r="11" fill="#f59e0b"/><circle cx="194" cy="125" r="11" fill="#22c55e"/>
<text x="232" y="134" fill="#e5e7eb" font-size="26" font-weight="750">Lunapad</text>
<text x="1530" y="134" fill="#94a3b8" font-size="20">${esc(frame.kicker ?? 'Demo video')}</text>

<rect x="88" y="190" width="350" height="780" rx="24" fill="#0f172a" stroke="#1f2937"/>
<text x="124" y="242" fill="#94a3b8" font-size="20" font-weight="700">Workspace</text>
${['Notebooks', 'Data', 'Metrics', 'dbt', 'AI', 'Share'].map((item, i) => `<rect x="124" y="${278 + i * 64}" width="258" height="42" rx="12" fill="${i === (frame.nav ?? 0) ? '#1d4ed8' : '#111827'}"/><text x="146" y="${306 + i * 64}" fill="#e5e7eb" font-size="20">${item}</text>`).join('\n')}

<rect x="474" y="190" width="1370" height="780" rx="24" fill="#f8fafc"/>
<text x="526" y="260" fill="#0f172a" font-size="52" font-weight="800" letter-spacing="-1.5">${esc(frame.title)}</text>
<text x="528" y="306" fill="#475569" font-size="26">${esc(frame.subtitle ?? '')}</text>

<rect x="526" y="350" width="390" height="96" rx="18" fill="#e0f2fe"/>
<text x="554" y="389" fill="#075985" font-size="22" font-weight="800">ACTION</text>
<text x="554" y="423" fill="#0f172a" font-size="26" font-weight="650">${esc(frame.action)}</text>

<rect x="526" y="480" width="390" height="330" rx="18" fill="#ffffff" stroke="#e2e8f0"/>
<text x="554" y="526" fill="#0f172a" font-size="24" font-weight="750">What viewers see</text>
${textBlock(
	bullets.map((b) => `• ${b}`),
	554,
	574,
	24,
	'#334155',
	500,
	1.45
)}

${code}
${stageCards}
${frame.callout ? `<rect x="982" y="680" width="790" height="128" rx="22" fill="#ecfdf5" stroke="#86efac"/><text x="1018" y="732" fill="#166534" font-size="30" font-weight="800">${esc(frame.callout)}</text>${textBlock(frame.calloutLines ?? [], 1018, 772, 22, '#14532d', 500, 1.3)}` : ''}

<rect x="526" y="866" width="1248" height="58" rx="18" fill="#0f172a"/>
<text x="560" y="903" fill="#e2e8f0" font-size="24" font-weight="650">${esc(frame.caption)}</text>
</svg>`;
}

async function renderVideo(browser, name, frames, targetMp4) {
	const dir = path.join(FRAME_ROOT, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const page = await browser.newPage({ viewport: { width: W, height: H } });
	const concat = [];
	for (const [i, frame] of frames.entries()) {
		const svg = path.join(dir, `${String(i + 1).padStart(2, '0')}.svg`);
		const png = path.join(dir, `${String(i + 1).padStart(2, '0')}.png`);
		fs.writeFileSync(svg, frameSvg(frame));
		await page.setContent(frameSvg(frame), { waitUntil: 'load' });
		await page.screenshot({ path: png, fullPage: false });
		concat.push(`file '${png.replaceAll("'", "'\\''")}'`);
		concat.push(`duration ${frame.duration}`);
	}
	await page.close();
	concat.push(
		`file '${path.join(dir, `${String(frames.length).padStart(2, '0')}.png`).replaceAll("'", "'\\''")}'`
	);
	const concatPath = path.join(dir, 'frames.txt');
	fs.writeFileSync(concatPath, concat.join('\n'));
	execFileSync(
		'ffmpeg',
		[
			'-y',
			'-f',
			'concat',
			'-safe',
			'0',
			'-i',
			concatPath,
			'-vf',
			'fps=30,format=yuv420p',
			'-c:v',
			'libx264',
			'-preset',
			'fast',
			'-crf',
			'20',
			targetMp4
		],
		{ stdio: 'inherit' }
	);
}

const sql = `SELECT
  month,
  total_revenue,
  total_revenue - LAG(total_revenue) OVER (ORDER BY month) AS mom_delta,
  ROUND(100.0 * (total_revenue - LAG(total_revenue) OVER (ORDER BY month))
        / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0), 1) AS mom_pct
FROM monthly_revenue
WHERE total_revenue > 0
ORDER BY month`;

const fast = [
	{
		duration: 12,
		title: 'Sales Analytics Demo',
		subtitle: 'SQL notebooks from raw data to dashboard',
		action: 'Open demo notebook',
		bullets: [
			'2,000 synthetic orders in DuckDB',
			'Named cells: orders, monthly_revenue, growth_analysis',
			'SQL-first, with PRQL and visual mode optional'
		],
		caption: 'A SQL notebook where every cell is a named model.'
	},
	{
		duration: 20,
		title: 'Run everything',
		subtitle: 'Populate tables, charts, stats, and dashboard widgets',
		action: 'Run all cells',
		bullets: [
			'One run populates the full notebook',
			'Downstream cells resolve dependencies automatically',
			'No boilerplate WITH chains to maintain'
		],
		caption: 'Run all cells, then hold on the populated results.'
	},
	{
		duration: 28,
		title: 'Plain SQL cell references',
		subtitle: 'growth_analysis reads monthly_revenue directly',
		action: 'Live SQL edit + run',
		bullets: [
			'Standard SQL window function',
			'Upstream cell name used as the table',
			'Visible table update after the edit'
		],
		code: sql,
		caption: 'Lead with SQL: monthly_revenue is just another cell.'
	},
	{
		duration: 22,
		title: 'Result views',
		subtitle: 'Same result, three useful lenses',
		action: 'Stats → Table → Chart',
		bullets: [
			'Stats: nulls, distinct counts, min/max',
			'Table: sortable/filterable rows',
			'Chart: instant visual exploration'
		],
		caption: 'Every result can become stats, a table, or a chart.'
	},
	{
		duration: 24,
		title: 'Optional visual pipeline',
		subtitle: 'A builder for people who do not want to write every query',
		action: 'Toggle Visual ↔ text',
		bullets: [
			'This is intentionally not the whole demo',
			'PRQL and GUI are power-ups',
			'SQL remains first-class'
		],
		stages: ['From orders', 'Derive revenue', 'Join targets', 'Group region', 'Sort revenue'],
		caption: 'PRQL and visual mode are optional power-ups, not the headline.'
	},
	{
		duration: 28,
		title: 'Interactive dashboard',
		subtitle: 'Markdoc widgets backed by live cells',
		action: 'Change Region: North → West',
		bullets: [
			'Metrics and progress update',
			'Chart reflects the selected region',
			'Linked detail table reruns from a SQL cell'
		],
		code: "SELECT region, product, category, customer_segment, quantity, unit_price, order_date\nFROM orders\nWHERE region = '${region}'\nORDER BY order_date DESC\nLIMIT 20",
		caption: 'Filters drive linked SQL-backed dashboard widgets.'
	},
	{
		duration: 22,
		title: 'Report view',
		subtitle: 'Hide code and present the dashboard',
		action: 'Toggle Report view',
		bullets: [
			'Clean stakeholder-facing surface',
			'Same notebook underneath',
			'Ready to share or publish'
		],
		callout: 'Notebook analytics',
		calloutLines: ['raw SQL → live cells → shareable report'],
		caption: 'End on a clean report, not a wall of code.'
	}
];

const full = [
	...fast.map((f) => ({
		...f,
		duration: Math.max(28, f.duration + 8),
		kicker: 'Full walkthrough'
	})),
	{
		duration: 44,
		title: 'Data ingest',
		subtitle: 'Bring files into the workspace',
		action: 'Upload CSV / Parquet',
		bullets: [
			'Upload dialog previews schema',
			'Imported table appears in the data browser',
			'Query it from a new SQL cell'
		],
		caption: 'Data ingest is an action beat, not a settings scroll.',
		kicker: 'Full walkthrough',
		nav: 1
	},
	{
		duration: 44,
		title: 'External connections',
		subtitle: 'Full deployments connect to real warehouses',
		action: 'Settings → Connections',
		bullets: [
			'Postgres and ClickHouse connections',
			'Read-only enforcement for server queries',
			'Credentials are deployment-specific'
		],
		callout: 'Not demo-mode locked',
		calloutLines: ['Recorded in full local mode; credentials are represented safely.'],
		caption: 'Show the connection surface without exposing secrets.',
		kicker: 'Full walkthrough',
		nav: 1
	},
	{
		duration: 54,
		title: 'Python cells',
		subtitle: 'Richer analysis when project + worker are available',
		action: 'Add Python cell',
		bullets: [
			'Requires a real project folder on disk',
			'Requires server-side Python worker readiness',
			'Uses pandas / Plotly against notebook outputs'
		],
		code: "df = orders.copy()\ndf['revenue'] = df.quantity * df.unit_price\nsummary = df.groupby('region').revenue.sum().reset_index()\nsummary",
		callout: 'Locked intentionally when runtime is missing',
		calloutLines: ['The UI unlocks this only when Python can actually run.'],
		caption: 'Cover Python honestly instead of hiding the lock.',
		kicker: 'Full walkthrough',
		nav: 0
	},
	{
		duration: 52,
		title: 'AI assistant',
		subtitle: 'Agent helps build and fix models',
		action: 'Ask AI → review diff → accept',
		bullets: [
			'Prompt references the active cell',
			'Inline diff keeps changes reviewable',
			'Fix-with-AI works from query errors'
		],
		caption: 'AI is shown as a controlled edit flow, not magic.',
		kicker: 'Full walkthrough',
		nav: 4
	},
	{
		duration: 50,
		title: 'dbt workflow',
		subtitle: 'Promote notebook cells into project files',
		action: 'Promote → compile → run/test → lineage',
		bullets: [
			'Open a dbt project folder',
			'Promote cells into dbt models/seeds',
			'Inspect lineage and schedules'
		],
		callout: 'Project-gated by design',
		calloutLines: ['dbt actions appear when a dbt project is open.'],
		caption: 'Show why the dbt panel unlocks only in project mode.',
		kicker: 'Full walkthrough',
		nav: 3
	},
	{
		duration: 45,
		title: 'Collaboration',
		subtitle: 'Review threads and team context',
		action: 'Comment → mention → resolve',
		bullets: [
			'Cell-level threads',
			'Review inbox with unread badge',
			'Presence avatars for teammates'
		],
		caption: 'Collaboration gets a concrete comment flow.',
		kicker: 'Full walkthrough'
	},
	{
		duration: 48,
		title: 'Share and Sites',
		subtitle: 'Publish reports and group them into multi-page sites',
		action: 'Share → publish → add to site',
		bullets: [
			'Single report link',
			'Site navigation across pages',
			'Refresh schedules and alerting for published reports'
		],
		caption: 'Publishing is a workflow, not just a button.',
		kicker: 'Full walkthrough',
		nav: 5
	},
	{
		duration: 40,
		title: 'Admin and automation',
		subtitle: 'Operate Lunapad as a team platform',
		action: 'Admin → API keys → MCP/REST',
		bullets: ['Roles and invitations', 'Personal API keys', 'Automation and MCP surfaces'],
		caption: 'Close with platform and automation surfaces.',
		kicker: 'Full walkthrough',
		nav: 5
	},
	{
		duration: 35,
		title: 'Final report',
		subtitle: 'SQL notebooks → live dashboards → shared reports',
		action: 'Return to Report view',
		bullets: [
			'Fast path for analysts',
			'Deep path for teams',
			'Full deployment unlocks Python, dbt, AI, and collaboration'
		],
		caption: 'End on the stakeholder-ready dashboard.',
		kicker: 'Full walkthrough'
	}
];

const browser = await chromium.launch();
await renderVideo(browser, 'fast', fast, path.join(OUT, 'fast-demo.mp4'));
await renderVideo(browser, 'full', full, path.join(OUT, 'full-walkthrough.mp4'));
await browser.close();

console.log(`Wrote ${path.join(OUT, 'fast-demo.mp4')}`);
console.log(`Wrote ${path.join(OUT, 'full-walkthrough.mp4')}`);
