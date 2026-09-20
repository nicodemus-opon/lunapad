import crypto from 'node:crypto';

// Generic external S3 gate for Docker boot (`storage-init` service).
// Works against any S3-compatible endpoint (AWS S3, R2, MinIO, Garage, RustFS)
// purely via env — no bundled object store required.
//
// Required env:
//   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID),
//   S3_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)
// Optional env:
//   S3_REGION (default us-east-1), S3_FORCE_PATH_STYLE (default true for
//   compatibles; set 'false' for AWS virtual-hosted style),
//   STORAGE_INIT_TIMEOUT_MS, STORAGE_INIT_POLL_MS, STORAGE_INIT_SKIP_BUCKET_CREATE=1
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
const skipBucketCreate = process.env.STORAGE_INIT_SKIP_BUCKET_CREATE === '1';
const timeoutMs = Number(process.env.STORAGE_INIT_TIMEOUT_MS ?? '120000');
const pollMs = Number(process.env.STORAGE_INIT_POLL_MS ?? '2000');

function requireEnv() {
	const missing = [];
	if (!endpoint) missing.push('S3_ENDPOINT');
	if (!bucket) missing.push('S3_BUCKET');
	if (!accessKey) missing.push('S3_ACCESS_KEY_ID');
	if (!secretKey) missing.push('S3_SECRET_ACCESS_KEY');
	if (missing.length > 0) {
		throw new Error(
			`External S3 is not configured. Missing: ${missing.join(', ')}. ` +
				`Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ S3_REGION, S3_FORCE_PATH_STYLE) on the Docker stack.`
		);
	}
}

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

function objectUrl(key = '') {
	const base = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
	const encodedKey = key.split('/').filter(Boolean).map(encodeURIComponent).join('/');
	if (forcePathStyle) {
		base.pathname = `${base.pathname.replace(/\/$/, '')}/${bucket}${encodedKey ? `/${encodedKey}` : ''}`;
		return base;
	}
	base.hostname = `${bucket}.${base.hostname}`;
	base.pathname = encodedKey ? `/${encodedKey}` : '/';
	return base;
}

function sign({ method, url, body = '', contentType }) {
	const { amzDate, dateStamp } = stamp();
	const payloadHash = hashHex(body);
	const headers = new Headers();
	headers.set('host', url.host);
	headers.set('x-amz-content-sha256', payloadHash);
	headers.set('x-amz-date', amzDate);
	if (contentType) headers.set('content-type', contentType);
	const signedHeaders = Array.from(headers.keys()).sort();
	const canonicalHeaders = signedHeaders
		.map((name) => `${name}:${headers.get(name).trim()}\n`)
		.join('');
	const canonicalRequest = [
		method,
		url.pathname,
		'',
		canonicalHeaders,
		signedHeaders.join(';'),
		payloadHash
	].join('\n');
	const scope = `${dateStamp}/${region}/s3/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hashHex(canonicalRequest)].join('\n');
	const signingKey = hmac(
		hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), 's3'),
		'aws4_request'
	);
	const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	headers.set(
		'authorization',
		`AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders.join(
			';'
		)}, Signature=${signature}`
	);
	return headers;
}

async function s3(method, key = '', body = '', contentType) {
	const url = objectUrl(key);
	const headers = sign({ method, url, body, contentType });
	return fetch(url, {
		method,
		headers,
		body: method === 'GET' || method === 'HEAD' ? undefined : body
	});
}

async function createBucket() {
	if (skipBucketCreate) {
		console.log(
			'STORAGE_INIT_SKIP_BUCKET_CREATE=1 — skipping bucket create (bucket must pre-exist).'
		);
		return;
	}
	const response = await s3('PUT');
	// 200/409: created / already exists (compatibles). 403: providers like AWS/R2
	// where the deployer pre-creates the bucket without s3:CreateBucket — treat as
	// "assume pre-created" and let the smoke test prove access.
	if (response.ok || response.status === 409 || response.status === 403) return;
	const text = await response.text().catch(() => '');
	throw new Error(`bucket create failed with ${response.status}${text ? `: ${text}` : ''}`);
}

async function smoke() {
	const key = `health/storage-init-${crypto.randomUUID()}.txt`;
	const body = 'ok';
	const put = await s3('PUT', key, body, 'text/plain; charset=utf-8');
	if (!put.ok) throw new Error(`smoke put failed with ${put.status}`);
	const get = await s3('GET', key);
	if (!get.ok) throw new Error(`smoke get failed with ${get.status}`);
	const text = await get.text();
	if (text !== body) throw new Error(`smoke get returned ${JSON.stringify(text)}`);
	const del = await s3('DELETE', key);
	if (!del.ok && del.status !== 404) throw new Error(`smoke delete failed with ${del.status}`);
}

async function main() {
	requireEnv();
	const started = Date.now();
	for (;;) {
		try {
			await createBucket();
			await smoke();
			console.log(`External S3 bucket "${bucket}" is ready at ${endpoint}.`);
			return;
		} catch (err) {
			if (Date.now() - started > timeoutMs) throw err;
			console.log(`Waiting for external S3 bucket "${bucket}": ${err.message}`);
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
