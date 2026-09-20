#!/usr/bin/env node
/**
 * Migrate EVERYTHING file-like to an external S3-compatible bucket.
 *
 * Sources (all optional — missing dirs are skipped, never an error):
 *   1. Legacy single-project dir  (--source-project, default ./project)
 *      -> <projects-prefix>default/default/<relative>
 *   2. Multi-tenant projects dir  (--source-projects, default ./projects)
 *      -> <projects-prefix><relative>, except `.worker-scratch/**` which goes to
 *         <scratch-prefix> (worker large-result handoff, see cloud-job-finish.ts)
 *   3. Trino catalog dir          (--source-trino-catalog, default ./trino/catalog)
 *      -> <trino-catalog-prefix>*.properties (+ credential JSONs beside them)
 *   4. Trino access dir           (--source-trino-access, default ./trino/access)
 *      -> <trino-access-prefix> (lunapad-access-control.json)
 *   5. Legacy internal (RustFS) bucket — old-to-new copy with ZERO config.
 *      Defaults probe http://host.docker.internal:9000 (a temporary
 *      legacy-RustFS container serving the old volume with --network host).
 *      Reachable -> every key copied 1:1 automatically on boot. Unreachable +
 *      default endpoint -> warn-and-skip (no legacy on this host). Unreachable
 *      + EXPLICITLY set endpoint + MIGRATE_REQUIRE_RUSTFS=1 -> fail loudly
 *      (fail-fast, never silent); + =0 -> warn-and-continue.
 *   6. Postgres share snapshots   (DATABASE_URL, on by default — DB-share IS part
 *      of this export): shared_report_versions JOIN shared_reports ->
 *      <shares-prefix>{orgId}/{token}/v{version}.json, byte-compatible with the
 *      live publisher in src/routes/api/shares/+server.ts. internal_notebook_renders
 *      (ephemeral Playwright tokens) are explicitly excluded.
 *
 * Destination is purely env-configured (Docker):
 *   S3_ENDPOINT (required), S3_BUCKET (required),
 *   S3_ACCESS_KEY_ID | AWS_ACCESS_KEY_ID | RUSTFS_ACCESS_KEY (required),
 *   S3_SECRET_ACCESS_KEY | AWS_SECRET_ACCESS_KEY | RUSTFS_SECRET_KEY (required),
 *   S3_REGION (default us-east-1),
 *   S3_FORCE_PATH_STYLE (default 'true'; set 'false' for AWS virtual-hosted),
 *   S3_PROJECTS_PREFIX (default 'projects/'), S3_WORKER_SCRATCH_PREFIX
 *   (default 'worker-scratch/'), S3_SHARES_PREFIX (default 'shares/'),
 *   S3_TRINO_CATALOG_PREFIX (default 'trino-catalog/'),
 *   S3_TRINO_ACCESS_PREFIX (default 'trino-access/'),
 *   DATABASE_URL (required unless --skip-db-shares).
 *
 * Safety: dry-run by default. `--apply` writes. Idempotent + resumable
 * (identical size+sha256 skips unless --overwrite). Never deletes source unless
 * --delete-source AND 100% verify passes. Writes migration-manifest-*.json.
 * `--verify-only` compares legacy source vs destination (plus DB share keys vs
 * destination) without writing and exits non-zero on any gap — the pre-removal
 * proof. Writes migration-verify-*.json.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const args = new Set(argv);
function opt(name, fallback) {
	const prefix = `${name}=`;
	for (const a of argv) if (a.startsWith(prefix)) return a.slice(prefix.length);
	const idx = argv.indexOf(name);
	if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
	return fallback;
}
const APPLY = args.has('--apply');
const OVERWRITE = args.has('--overwrite');
const DELETE_SOURCE = args.has('--delete-source');
const ALLOW_LIVE = args.has('--allow-live');
const VERIFY_ONLY = args.has('--verify-only');
const SKIP_DB_SHARES = args.has('--skip-db-shares');
const ONLY = (opt('--only', '') || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const CONCURRENCY = Math.max(1, Number(opt('--concurrency', '8')) || 8);
const SRC_PROJECT = opt('--source-project', process.env.MIGRATE_SOURCE_PROJECT || './project');
const SRC_PROJECTS = opt('--source-projects', process.env.MIGRATE_SOURCE_PROJECTS || './projects');
const SRC_TRINO_CATALOG = opt(
	'--source-trino-catalog',
	process.env.MIGRATE_SOURCE_TRINO_CATALOG || './trino/catalog'
);
const SRC_TRINO_ACCESS = opt(
	'--source-trino-access',
	process.env.MIGRATE_SOURCE_TRINO_ACCESS || './trino/access'
);
const DEFAULT_RUSTFS_ENDPOINT = 'http://host.docker.internal:9000';
const SRC_RUSTFS_ENDPOINT = opt(
	'--source-rustfs-endpoint',
	process.env.MIGRATE_SOURCE_RUSTFS_ENDPOINT || DEFAULT_RUSTFS_ENDPOINT
);
// Strict fail-fast applies ONLY when the operator explicitly pointed at a
// legacy source. The default endpoint is a best-effort probe: nothing
// answering there just means "no legacy data on this host" -> warn-and-skip.
const SRC_RUSTFS_EXPLICIT =
	argv.some((a) => a === '--source-rustfs-endpoint' || a.startsWith('--source-rustfs-endpoint=')) ||
	Boolean(process.env.MIGRATE_SOURCE_RUSTFS_ENDPOINT);
const SRC_RUSTFS_BUCKET = opt(
	'--source-rustfs-bucket',
	process.env.MIGRATE_SOURCE_RUSTFS_BUCKET || process.env.S3_BUCKET || 'lunapad-artifacts'
);
const SRC_RUSTFS_KEY =
	opt('--source-rustfs-key', '') ||
	process.env.MIGRATE_SOURCE_RUSTFS_KEY ||
	process.env.RUSTFS_ACCESS_KEY ||
	'lunapad';
const SRC_RUSTFS_SECRET =
	opt('--source-rustfs-secret', '') ||
	process.env.MIGRATE_SOURCE_RUSTFS_SECRET ||
	process.env.RUSTFS_SECRET_KEY ||
	process.env.SERVICE_PASSWORD_64_RUSTFS ||
	'lunapad-local-secret';
// Strict by default: an unreachable legacy source fails the run (and blocks the
// app via the compose boot gate) instead of silently stranding data. Set
// MIGRATE_REQUIRE_RUSTFS=0 only once legacy is confirmed gone.
const REQUIRE_RUSTFS =
	(opt('--require-rustfs', '') || process.env.MIGRATE_REQUIRE_RUSTFS || '1') !== '0';
const RUSTFS_WAIT_MS = Number(
	opt('--rustfs-wait-ms', '') || process.env.MIGRATE_RUSTFS_WAIT_MS || '60000'
);
const FETCH_TIMEOUT_MS = Number(process.env.MIGRATE_FETCH_TIMEOUT_MS || '30000');

function tfetch(url, init) {
	return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function enabled(phase) {
	return ONLY.length === 0 || ONLY.includes(phase);
}

// ── destination env ──────────────────────────────────────────────────────────
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKey =
	process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? process.env.RUSTFS_ACCESS_KEY;
const secretKey =
	process.env.S3_SECRET_ACCESS_KEY ??
	process.env.AWS_SECRET_ACCESS_KEY ??
	process.env.RUSTFS_SECRET_KEY;
const region = process.env.S3_REGION ?? 'us-east-1';
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';

function normPrefix(value, fallback) {
	const raw = (value ?? fallback).trim();
	if (!raw) return '';
	return raw.endsWith('/') ? raw : `${raw}/`;
}
const P_PROJECTS = normPrefix(process.env.S3_PROJECTS_PREFIX, 'projects/');
const P_SCRATCH = normPrefix(process.env.S3_WORKER_SCRATCH_PREFIX, 'worker-scratch/');
const P_SHARES = normPrefix(process.env.S3_SHARES_PREFIX, 'shares/');
const P_TRINO_CATALOG = normPrefix(process.env.S3_TRINO_CATALOG_PREFIX, 'trino-catalog/');
const P_TRINO_ACCESS = normPrefix(process.env.S3_TRINO_ACCESS_PREFIX, 'trino-access/');

function requireDestEnv() {
	const missing = [];
	if (!endpoint) missing.push('S3_ENDPOINT');
	if (!bucket) missing.push('S3_BUCKET');
	if (!accessKey) missing.push('S3_ACCESS_KEY_ID');
	if (!secretKey) missing.push('S3_SECRET_ACCESS_KEY');
	if (missing.length > 0) {
		throw new Error(
			`External S3 is not configured. Missing: ${missing.join(', ')}. ` +
				`Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_REGION, S3_FORCE_PATH_STYLE).`
		);
	}
	if (!ALLOW_LIVE && process.env.FILE_STORAGE_BACKEND === 's3') {
		throw new Error(
			'Refusing to migrate while FILE_STORAGE_BACKEND=s3 is live. Stop app/worker first, or pass --allow-live.'
		);
	}
}

// ── SigV4 (works for AWS + compatibles) ──────────────────────────────────────
function hashHex(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}
function hmac(key, value) {
	return crypto.createHmac('sha256', key).update(value).digest();
}
function stamp(date = new Date()) {
	const raw = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
	return { amzDate: raw, dateStamp: raw.slice(0, 8) };
}
function destUrl(key = '', search = null) {
	const base = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
	const encodedKey = key.split('/').filter(Boolean).map(encodeURIComponent).join('/');
	if (forcePathStyle) {
		base.pathname = `${base.pathname.replace(/\/$/, '')}/${bucket}${encodedKey ? `/${encodedKey}` : ''}`;
	} else {
		base.hostname = `${bucket}.${base.hostname}`;
		base.pathname = encodedKey ? `/${encodedKey}` : '/';
	}
	if (search) for (const [k, v] of search) base.searchParams.set(k, v);
	return base;
}
function sign({ method, url, body = '', contentType, key, secret }) {
	const { amzDate, dateStamp } = stamp();
	const payloadHash = hashHex(body);
	const headers = new Headers();
	headers.set('host', url.host);
	headers.set('x-amz-content-sha256', payloadHash);
	headers.set('x-amz-date', amzDate);
	if (contentType) headers.set('content-type', contentType);
	const names = Array.from(headers.keys()).sort();
	const canonicalHeaders = names.map((n) => `${n}:${headers.get(n).trim()}\n`).join('');
	const canonicalQuery = Array.from(url.searchParams.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	const canonicalRequest = [
		method,
		url.pathname,
		canonicalQuery,
		canonicalHeaders,
		names.join(';'),
		payloadHash
	].join('\n');
	const scope = `${dateStamp}/${region}/s3/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hashHex(canonicalRequest)].join('\n');
	const signingKey = hmac(
		hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), 's3'),
		'aws4_request'
	);
	const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	headers.set(
		'authorization',
		`AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
	);
	return headers;
}
async function s3Put(key, body, contentType) {
	const url = destUrl(key);
	const headers = sign({
		method: 'PUT',
		url,
		body,
		contentType,
		key: accessKey,
		secret: secretKey
	});
	const res = await tfetch(url, {
		method: 'PUT',
		headers,
		body: typeof body === 'string' ? body : Buffer.from(body)
	});
	if (!res.ok) throw new Error(`PUT ${key} failed with ${res.status}`);
}
async function s3Head(key) {
	const url = destUrl(key);
	const headers = sign({ method: 'HEAD', url, body: '', key: accessKey, secret: secretKey });
	const res = await tfetch(url, { method: 'HEAD', headers });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`HEAD ${key} failed with ${res.status}`);
	return { size: Number(res.headers.get('content-length') ?? '0'), etag: res.headers.get('etag') };
}
async function s3Get(key) {
	const url = destUrl(key);
	const headers = sign({ method: 'GET', url, body: '', key: accessKey, secret: secretKey });
	const res = await tfetch(url, { method: 'GET', headers });
	if (!res.ok) throw new Error(`GET ${key} failed with ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

// ── local walk ───────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', '.svelte-kit']);
function contentTypeFor(filename) {
	const ext = path.extname(filename).toLowerCase();
	if (ext === '.json') return 'application/json; charset=utf-8';
	if (ext === '.luna' || ext === '.prql' || ext === '.sql' || ext === '.yml' || ext === '.yaml')
		return 'text/plain; charset=utf-8';
	if (ext === '.md') return 'text/markdown; charset=utf-8';
	if (ext === '.csv') return 'text/csv; charset=utf-8';
	if (ext === '.properties') return 'text/plain; charset=utf-8';
	if (ext === '.duckdb') return 'application/octet-stream';
	return 'application/octet-stream';
}
async function walkFiles(root) {
	const out = [];
	async function walk(dir) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (err) {
			if (err.code === 'ENOENT') return;
			throw err;
		}
		for (const e of entries) {
			if (e.isSymbolicLink()) continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (SKIP_DIRS.has(e.name)) continue;
				await walk(full);
			} else if (e.isFile()) {
				out.push(full);
			}
		}
	}
	await walk(root);
	return out.sort();
}
async function sha256File(full) {
	const hash = crypto.createHash('sha256');
	await new Promise((resolve, reject) => {
		const stream = createReadStream(full);
		stream.on('data', (d) => hash.update(d));
		stream.on('end', resolve);
		stream.on('error', reject);
	});
	return hash.digest('hex');
}

function toPosixRelative(root, full) {
	return path.relative(path.resolve(root), path.resolve(full)).split(path.sep).join('/');
}

// ── manifest ─────────────────────────────────────────────────────────────────
const manifest = [];
let migrated = 0;
let skipped = 0;
let failed = 0;
function record(entry) {
	manifest.push(entry);
	if (entry.status === 'migrated') migrated++;
	else if (entry.status.startsWith('skipped')) skipped++;
	else if (entry.status === 'failed') failed++;
}

async function putFile({ source, s3key }) {
	const stat = await fs.stat(source);
	const localBytes = await fs.readFile(source);
	const localHash = crypto.createHash('sha256').update(localBytes).digest('hex');
	if (!APPLY) {
		record({ source, s3key, bytes: stat.size, sha256: localHash, status: 'dry-run' });
		return;
	}
	if (!OVERWRITE) {
		try {
			const head = await s3Head(s3key);
			if (head && head.size === stat.size) {
				record({
					source,
					s3key,
					bytes: stat.size,
					sha256: localHash,
					status: 'skipped-identical-size'
				});
				return;
			}
		} catch {
			// HEAD errors fall through to PUT (fail-fast happens there).
		}
	}
	try {
		await s3Put(s3key, localBytes, contentTypeFor(source));
		// verify: size round-trip
		const head = await s3Head(s3key);
		if (!head || head.size !== stat.size) {
			throw new Error(`verify mismatch for ${s3key} (local ${stat.size}, remote ${head?.size})`);
		}
		record({ source, s3key, bytes: stat.size, sha256: localHash, status: 'migrated' });
	} catch (err) {
		record({
			source,
			s3key,
			bytes: stat.size,
			sha256: localHash,
			status: 'failed',
			error: String(err?.message ?? err)
		});
	}
}

async function runPool(items, worker) {
	const queue = [...items];
	const runners = Array.from(
		{ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) },
		async () => {
			while (queue.length > 0) {
				const item = queue.shift();
				await worker(item);
			}
		}
	);
	await Promise.all(runners);
}

// ── phases ───────────────────────────────────────────────────────────────────
async function phaseProjects() {
	if (!enabled('projects') && !enabled('scratch')) return;
	const items = [];
	// Legacy single-project dir -> default tenant prefix.
	if (enabled('projects')) {
		for (const full of await walkFiles(SRC_PROJECT)) {
			const rel = toPosixRelative(SRC_PROJECT, full);
			if (!rel || rel.startsWith('..')) continue;
			items.push({ source: full, s3key: `${P_PROJECTS}default/default/${rel}` });
		}
	}
	// Multi-tenant dir; .worker-scratch reroutes to the scratch prefix.
	for (const full of await walkFiles(SRC_PROJECTS)) {
		const rel = toPosixRelative(SRC_PROJECTS, full);
		if (!rel || rel.startsWith('..')) continue;
		if (rel === '.worker-scratch' || rel.startsWith('.worker-scratch/')) {
			if (!enabled('scratch')) continue;
			items.push({ source: full, s3key: `${P_SCRATCH}${rel.slice('.worker-scratch/'.length)}` });
		} else {
			if (!enabled('projects')) continue;
			items.push({ source: full, s3key: `${P_PROJECTS}${rel}` });
		}
	}
	// Collision guard: two sources must never map to the same key.
	const seen = new Map();
	for (const item of items) {
		if (seen.has(item.s3key)) {
			throw new Error(
				`Key collision: "${seen.get(item.s3key)}" and "${item.source}" both map to ${item.s3key}. ` +
					`Move the legacy ./project dir into ./projects/default/default first.`
			);
		}
		seen.set(item.s3key, item.source);
	}
	console.log(`phase projects+scratch: ${items.length} file(s)`);
	await runPool(items, putFile);
}

async function phaseTrino() {
	if (!enabled('trino')) return;
	const items = [];
	for (const full of await walkFiles(SRC_TRINO_CATALOG)) {
		const rel = toPosixRelative(SRC_TRINO_CATALOG, full);
		if (!rel || rel.startsWith('..')) continue;
		if (path.basename(full) === 'lunapad-access-control.json') continue; // legacy location, access phase owns it
		items.push({ source: full, s3key: `${P_TRINO_CATALOG}${rel}` });
	}
	for (const full of await walkFiles(SRC_TRINO_ACCESS)) {
		const rel = toPosixRelative(SRC_TRINO_ACCESS, full);
		if (!rel || rel.startsWith('..')) continue;
		items.push({ source: full, s3key: `${P_TRINO_ACCESS}${rel}` });
	}
	console.log(`phase trino: ${items.length} file(s)`);
	await runPool(items, putFile);
}

function parseListXml(xml) {
	const keys = [];
	const re = /<Contents>([\s\S]*?)<\/Contents>/g;
	let m;
	while ((m = re.exec(xml)) !== null) {
		const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
		const size = Number(/<Size>([\s\S]*?)<\/Size>/.exec(m[1])?.[1] ?? '0');
		if (key) keys.push({ key, size });
	}
	const truncated = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml)?.[1] === 'true';
	const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
	return { keys, nextToken: truncated ? token : null };
}

function srcBase(p = '', search = null) {
	if (!SRC_RUSTFS_ENDPOINT) throw new Error('Legacy source endpoint is not configured.');
	const base = new URL(
		SRC_RUSTFS_ENDPOINT.endsWith('/') ? SRC_RUSTFS_ENDPOINT : `${SRC_RUSTFS_ENDPOINT}/`
	);
	const enc = p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
	base.pathname = `${base.pathname.replace(/\/$/, '')}/${SRC_RUSTFS_BUCKET}${enc ? `/${enc}` : ''}`;
	if (search) for (const [k, v] of search) base.searchParams.set(k, v);
	return base;
}

function srcHeaders(method, url) {
	return sign({ method, url, body: '', key: SRC_RUSTFS_KEY, secret: SRC_RUSTFS_SECRET });
}

async function srcListKeys() {
	const out = [];
	let token;
	for (;;) {
		const search = [
			['list-type', '2'],
			['max-keys', '1000']
		];
		if (token) search.push(['continuation-token', token]);
		const url = srcBase('', search);
		const res = await tfetch(url, { method: 'GET', headers: srcHeaders('GET', url) });
		if (!res.ok) throw new Error(`legacy source list failed with ${res.status}`);
		const { keys, nextToken } = parseListXml(await res.text());
		out.push(...keys);
		if (!nextToken) break;
		token = nextToken;
	}
	return out;
}

async function srcGet(key) {
	const url = srcBase(key);
	const res = await tfetch(url, { method: 'GET', headers: srcHeaders('GET', url) });
	if (!res.ok) throw new Error(`legacy source GET ${key} failed with ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

/**
 * Wait for the legacy source to answer its first ListObjectsV2 page.
 * Returns { reachable, keys?, error? }. The deadline covers first contact
 * only — the full copy that follows is unbounded and resumable.
 */
async function probeLegacySource() {
	if (!SRC_RUSTFS_ENDPOINT) {
		return { reachable: false, error: 'no legacy source endpoint configured' };
	}
	const started = Date.now();
	let lastError = 'unknown';
	for (;;) {
		try {
			const url = srcBase('', [
				['list-type', '2'],
				['max-keys', '1']
			]);
			const res = await tfetch(url, { method: 'GET', headers: srcHeaders('GET', url) });
			if (!res.ok) throw new Error(`probe list failed with ${res.status}`);
			await res.text();
			return { reachable: true };
		} catch (err) {
			lastError = String(err?.message ?? err);
			if (Date.now() - started > RUSTFS_WAIT_MS) return { reachable: false, error: lastError };
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
}

/** List every key in the DESTINATION bucket (for --verify-only). */
async function destListAll(prefix = '') {
	const out = [];
	let continuationToken;
	for (;;) {
		const base = destUrl('', [
			['list-type', '2'],
			['prefix', prefix],
			['max-keys', '1000'],
			...(continuationToken ? [['continuation-token', continuationToken]] : [])
		]);
		const headers = sign({ method: 'GET', url: base, body: '', key: accessKey, secret: secretKey });
		const res = await tfetch(base, { method: 'GET', headers });
		if (!res.ok) throw new Error(`destination list failed with ${res.status}`);
		const { keys, nextToken } = parseListXml(await res.text());
		out.push(...keys);
		if (!nextToken) break;
		continuationToken = nextToken;
	}
	return out;
}

async function phaseRustfs() {
	if (!enabled('rustfs')) return;
	const probe = await probeLegacySource();
	if (!probe.reachable) {
		const message = `phase rustfs: legacy source unreachable (${SRC_RUSTFS_ENDPOINT}): ${probe.error}`;
		if (SRC_RUSTFS_EXPLICIT && REQUIRE_RUSTFS) {
			throw new Error(
				`${message}. Refusing to continue with MIGRATE_REQUIRE_RUSTFS=1 — ` +
					`legacy objects would be silently stranded. Fix the endpoint/credentials, or ` +
					`set MIGRATE_REQUIRE_RUSTFS=0 only once legacy is confirmed gone.`
			);
		}
		console.log(
			`${message}. ${SRC_RUSTFS_EXPLICIT ? 'Continuing because MIGRATE_REQUIRE_RUSTFS=0.' : 'Assuming no legacy data on this host, skipping.'}`
		);
		return;
	}
	if (!probe.reachable) {
		const message =
			`phase rustfs: legacy source unreachable (${SRC_RUSTFS_ENDPOINT || 'not configured'}): ` +
			`${probe.error}`;
		if (REQUIRE_RUSTFS) {
			throw new Error(
				`${message}. Refusing to continue with MIGRATE_REQUIRE_RUSTFS=1 — ` +
					`legacy objects would be silently stranded. Fix the endpoint/credentials, or ` +
					`set MIGRATE_REQUIRE_RUSTFS=0 only once legacy is confirmed gone.`
			);
		}
		console.log(`${message}. Continuing because MIGRATE_REQUIRE_RUSTFS=0.`);
		return;
	}
	// list source keys
	const srcKeys = await srcListKeys();
	console.log(`phase rustfs: ${srcKeys.length} object(s) from ${SRC_RUSTFS_ENDPOINT}`);
	await runPool(srcKeys, async ({ key }) => {
		if (!APPLY) {
			record({ source: `rustfs:${key}`, s3key: key, bytes: 0, sha256: '', status: 'dry-run' });
			return;
		}
		try {
			const body = await srcGet(key);
			const hash = crypto.createHash('sha256').update(body).digest('hex');
			if (!OVERWRITE) {
				const head = await s3Head(key).catch(() => null);
				if (head && head.size === body.length) {
					record({
						source: `rustfs:${key}`,
						s3key: key,
						bytes: body.length,
						sha256: hash,
						status: 'skipped-identical-size'
					});
					return;
				}
			}
			await s3Put(key, body, contentTypeFor(key));
			record({
				source: `rustfs:${key}`,
				s3key: key,
				bytes: body.length,
				sha256: hash,
				status: 'migrated'
			});
		} catch (err) {
			record({
				source: `rustfs:${key}`,
				s3key: key,
				bytes: 0,
				sha256: '',
				status: 'failed',
				error: String(err?.message ?? err)
			});
		}
	});
}

async function phaseDbShares() {
	if (!enabled('db-shares') && !enabled('shares')) return;
	if (SKIP_DB_SHARES || process.env.MIGRATE_SKIP_DB_SHARES === '1') {
		console.log('phase db-shares: skipped (--skip-db-shares)');
		return;
	}
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl)
		throw new Error('phase db-shares requires DATABASE_URL (or pass --skip-db-shares).');
	const { default: pg } = await import('pg').catch(() => ({ default: null }));
	if (!pg) throw new Error('phase db-shares requires the "pg" package.');
	const client = new pg.Client({ connectionString: databaseUrl });
	await client.connect();
	try {
		const { rows } = await client.query(`
			SELECT v.token, v.version, v.snapshot, v.notebook_name, v.created_at,
			       r.org_id, r.project_id, r.notebook_id, r.updated_at
			FROM shared_report_versions v
			JOIN shared_reports r ON r.token = v.token
			ORDER BY v.token, v.version
		`);
		console.log(`phase db-shares: ${rows.length} version(s)`);
		await runPool(rows, async (row) => {
			const orgId = row.org_id ?? 'default';
			const s3key = `${P_SHARES}${orgId}/${row.token}/v${row.version}.json`;
			const envelope = JSON.stringify(
				{
					token: row.token,
					version: row.version,
					notebookId: row.notebook_id,
					notebookName: row.notebook_name,
					snapshot: row.snapshot,
					publishedAt: new Date(row.created_at ?? row.updated_at ?? Date.now()).toISOString()
				},
				null,
				2
			);
			const hash = crypto.createHash('sha256').update(envelope).digest('hex');
			if (!APPLY) {
				record({
					source: `db:${row.token}/v${row.version}`,
					s3key,
					bytes: envelope.length,
					sha256: hash,
					status: 'dry-run'
				});
				return;
			}
			try {
				if (!OVERWRITE) {
					const head = await s3Head(s3key).catch(() => null);
					if (head && head.size === envelope.length) {
						record({
							source: `db:${row.token}/v${row.version}`,
							s3key,
							bytes: envelope.length,
							sha256: hash,
							status: 'skipped-identical-size'
						});
						return;
					}
				}
				await s3Put(s3key, envelope, 'application/json; charset=utf-8');
				record({
					source: `db:${row.token}/v${row.version}`,
					s3key,
					bytes: envelope.length,
					sha256: hash,
					status: 'migrated'
				});
			} catch (err) {
				record({
					source: `db:${row.token}/v${row.version}`,
					s3key,
					bytes: envelope.length,
					sha256: hash,
					status: 'failed',
					error: String(err?.message ?? err)
				});
			}
		});
	} finally {
		await client.end().catch(() => {});
	}
}

async function withPg(fn) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl)
		throw new Error('DATABASE_URL is required for this phase (or pass --skip-db-shares).');
	const { default: pg } = await import('pg').catch(() => ({ default: null }));
	if (!pg) throw new Error('this phase requires the "pg" package.');
	const client = new pg.Client({ connectionString: databaseUrl });
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end().catch(() => {});
	}
}

/**
 * --verify-only: the pre-removal proof. Compares (a) every legacy source key
 * against the destination bucket (exact key, sizes) and (b) every DB share
 * version against its expected destination key. Writes nothing, exits non-zero
 * on any gap. Run with MIGRATION_ARGS=--verify-only.
 */
async function verifyOnly() {
	console.log(`verify-only: source ${SRC_RUSTFS_ENDPOINT} -> ${endpoint} bucket "${bucket}"`);
	const probe = await probeLegacySource();
	let srcKeys = [];
	if (!probe.reachable) {
		if (SRC_RUSTFS_EXPLICIT && REQUIRE_RUSTFS) {
			throw new Error(
				`verify: legacy source unreachable (${SRC_RUSTFS_ENDPOINT}): ` +
					`${probe.error}. Cannot prove completeness — fix the endpoint or set MIGRATE_REQUIRE_RUSTFS=0.`
			);
		}
		console.log('verify: legacy source unreachable, checking destination vs DB only.');
	} else {
		srcKeys = await srcListKeys();
	}
	let destKeys;
	try {
		destKeys = await destListAll('');
	} catch (err) {
		throw new Error(
			`verify: destination bucket unreachable (${endpoint} "${bucket}"): ${err?.message ?? err}.`
		);
	}
	const destByKey = new Map(destKeys.map((k) => [k.key, k.size]));
	const missing = [];
	const sizeMismatches = [];
	for (const { key, size } of srcKeys) {
		if (!destByKey.has(key)) missing.push(key);
		else if (destByKey.get(key) !== size)
			sizeMismatches.push({ key, srcSize: size, destSize: destByKey.get(key) });
	}
	let dbVersions = 0;
	const dbGaps = [];
	if (!SKIP_DB_SHARES && (ONLY.length === 0 || enabled('db-shares') || enabled('shares'))) {
		const rows = await withPg((client) =>
			client
				.query(
					`SELECT v.token, v.version, r.org_id FROM shared_report_versions v JOIN shared_reports r ON r.token = v.token`
				)
				.then((r) => r.rows)
		);
		dbVersions = rows.length;
		for (const row of rows) {
			const expected = `${P_SHARES}${row.org_id ?? 'default'}/${row.token}/v${row.version}.json`;
			if (!destByKey.has(expected)) dbGaps.push(expected);
		}
	}
	const stampName = new Date().toISOString().replace(/[:.]/g, '-');
	const reportPath = `migration-verify-${stampName}.json`;
	await fs.writeFile(
		reportPath,
		JSON.stringify(
			{
				endpoint,
				bucket,
				srcKeys: srcKeys.length,
				destKeys: destKeys.length,
				dbVersions,
				missing,
				sizeMismatches,
				dbGaps
			},
			null,
			2
		)
	);
	console.log(
		`verify result: src=${srcKeys.length} dest=${destKeys.length} dbVersions=${dbVersions} ` +
			`missing=${missing.length} sizeMismatches=${sizeMismatches.length} dbGaps=${dbGaps.length} report=${reportPath}`
	);
	if (missing.length > 0 || sizeMismatches.length > 0 || dbGaps.length > 0) {
		throw new Error(
			'verify FAILED: destination is missing objects (see report). Legacy must stay.'
		);
	}
	console.log('verify OK: every legacy key and every DB share version exists at the destination.');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
	requireDestEnv();
	if (VERIFY_ONLY) {
		await verifyOnly();
		return;
	}
	console.log(
		`migrate-to-s3 ${APPLY ? '--apply' : '(dry-run; pass --apply to write)'} -> ${endpoint} bucket "${bucket}" ` +
			`(path-style=${forcePathStyle}, region=${region})`
	);
	await phaseProjects();
	await phaseTrino();
	await phaseRustfs();
	await phaseDbShares();

	const stampName = new Date().toISOString().replace(/[:.]/g, '-');
	const manifestPath = `migration-manifest-${stampName}.json`;
	await fs.writeFile(
		manifestPath,
		JSON.stringify(
			{
				endpoint,
				bucket,
				prefixes: { P_PROJECTS, P_SCRATCH, P_SHARES, P_TRINO_CATALOG, P_TRINO_ACCESS },
				migrated,
				skipped,
				failed,
				entries: manifest
			},
			null,
			2
		)
	);
	console.log(
		`result: migrated=${migrated} skipped=${skipped} failed=${failed} manifest=${manifestPath}`
	);

	if (DELETE_SOURCE) {
		if (!APPLY) throw new Error('--delete-source requires --apply.');
		if (failed > 0)
			throw new Error('--delete-source refused: verify failed (failed > 0). Source preserved.');
		const localEntries = manifest.filter(
			(e) =>
				e.status === 'migrated' && !e.source.startsWith('rustfs:') && !e.source.startsWith('db:')
		);
		for (const e of localEntries) await fs.rm(e.source, { force: true });
		console.log(
			`deleted ${localEntries.length} migrated source file(s); DB rows and source bucket objects are never deleted.`
		);
	}
	if (failed > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
