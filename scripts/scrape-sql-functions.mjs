#!/usr/bin/env node
/**
 * One-shot scraper: Trino + DuckDB function docs → src/lib/data/{trino,duckdb}-functions.json
 * Run: node scripts/scrape-sql-functions.mjs
 *
 * Trino: <dt class="sig sig-object py" id="NAME">signature</dt><dd><p>desc</p></dd>
 * DuckDB: <h4 id="..."><code>sig(args)</code></h4> + <table> with Description row
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../src/lib/data');
mkdirSync(OUT, { recursive: true });

function stripHtml(html) {
	return html
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function get(url) {
	const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 sql-catalog-scraper/1.0' } });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.text();
}

function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────── TRINO ──────────────────────────────────────────
// Structure: <dt class="sig sig-object py" id="NAME">...sig spans...</dt>
//            <dd><p>Description sentence.</p>...</dd>

const TRINO_CATS = [
	'aggregate',
	'array',
	'binary',
	'bitwise',
	'color',
	'comparison',
	'conditional',
	'conversion',
	'datasketches',
	'datetime',
	'decimal',
	'geospatial',
	'hyperloglog',
	'ipaddress',
	'json',
	'lambda',
	'map',
	'math',
	'regexp',
	'row',
	'session',
	'setdigest',
	'string',
	'system',
	'table',
	'teradata',
	'tdigest',
	'url',
	'uuid',
	'window'
];

function parseTrinoPage(html) {
	const fns = [];
	// Match dt with id + immediately following dd (multiline)
	const re =
		/<dt\s+class="sig sig-object py"[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		const name = m[1].toLowerCase().replace(/-/g, '_');
		// Build signature: strip all HTML, collapse whitespace, keep → arrow
		const sig = stripHtml(m[2])
			.replace(/→/g, '→')
			.replace(/->/g, '→')
			.replace(/\s*#\s*$/, '')
			.replace(/\s+/g, ' ')
			.trim();

		// Skip non-function entries (no parentheses)
		if (!sig.includes('(')) continue;

		// First <p> in <dd> is the description
		const pM = m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
		if (!pM) continue;
		const doc = stripHtml(pM[1]).replace(/\s+/g, ' ').trim().slice(0, 300);
		if (!doc) continue;

		fns.push({ name, signature: sig, doc });
	}
	return fns;
}

async function scrapeTrino() {
	console.log('Trino:');
	const seen = new Map();
	for (const cat of TRINO_CATS) {
		const url = `https://trino.io/docs/current/functions/${cat}.html`;
		try {
			const html = await get(url);
			const fns = parseTrinoPage(html);
			let added = 0;
			for (const fn of fns) {
				if (!seen.has(fn.name)) {
					seen.set(fn.name, fn);
					added++;
				}
			}
			console.log(`  ${cat}: ${fns.length} parsed, ${added} new`);
		} catch (e) {
			console.warn(`  ${cat}: FAILED — ${e.message}`);
		}
		await delay(150);
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ──────────────────────────── DUCKDB ─────────────────────────────────────────
// Structure: <h4 id="..."><a><code>func(args)</code></a></h4>
//            <table><tr><td><strong>Description</strong></td><td>desc</td></tr>...</table>

const DUCKDB_CATS = [
	'numeric',
	'char',
	'date',
	'time',
	'timestamp',
	'interval',
	'blob',
	'list',
	'array',
	'struct',
	'map',
	'union',
	'aggregates',
	'utility'
];

function parseDuckDBPage(html) {
	const fns = [];
	// h4 with code inside, followed by a table with Description row
	const re =
		/<h4[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/h4>([\s\S]*?)(?=<h4|<h3|<h2|$)/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		const sig = stripHtml(m[1]).replace(/\s+/g, ' ').trim();
		if (!sig.includes('(') && !sig.match(/^@/)) continue;

		const nameM = sig.match(/^@?([a-z_][a-z0-9_$]*)\s*[\(@]/i);
		if (!nameM) continue;
		const name = nameM[1].toLowerCase();
		const signature = sig;

		// Find Description row in following table
		const body = m[2];
		const descM = body.match(/<strong>Description<\/strong><\/td>\s*<td>([\s\S]*?)<\/td>/i);
		if (!descM) continue;
		const doc = stripHtml(descM[1]).replace(/\s+/g, ' ').trim().slice(0, 300);
		if (!doc) continue;

		fns.push({ name, signature, doc });
	}
	return fns;
}

async function scrapeDuckDB() {
	console.log('\nDuckDB:');
	const seen = new Map();
	for (const cat of DUCKDB_CATS) {
		const url = `https://duckdb.org/docs/current/sql/functions/${cat}.html`;
		try {
			const html = await get(url);
			const fns = parseDuckDBPage(html);
			let added = 0;
			for (const fn of fns) {
				if (!seen.has(fn.name)) {
					seen.set(fn.name, fn);
					added++;
				}
			}
			console.log(`  ${cat}: ${fns.length} parsed, ${added} new`);
		} catch (e) {
			console.warn(`  ${cat}: FAILED — ${e.message}`);
		}
		await delay(150);
	}
	return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────

const trino = await scrapeTrino();
const duckdb = await scrapeDuckDB();

writeFileSync(join(OUT, 'trino-functions.json'), JSON.stringify(trino, null, 2));
writeFileSync(join(OUT, 'duckdb-functions.json'), JSON.stringify(duckdb, null, 2));

console.log(`\nDone. Trino: ${trino.length} functions, DuckDB: ${duckdb.length} functions`);
console.log(`Output: src/lib/data/trino-functions.json, src/lib/data/duckdb-functions.json`);
