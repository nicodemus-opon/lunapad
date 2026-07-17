import crypto from 'node:crypto';

const endpoint = process.env.S3_ENDPOINT ?? 'http://rustfs:9000';
const bucket = process.env.S3_BUCKET ?? 'lunapad-artifacts';
const accessKey = process.env.S3_ACCESS_KEY_ID ?? process.env.RUSTFS_ACCESS_KEY ?? 'lunapad';
const secretKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.RUSTFS_SECRET_KEY ?? 'lunapad-local-secret';
const region = process.env.S3_REGION ?? 'us-east-1';
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';
const timeoutMs = Number(process.env.STORAGE_INIT_TIMEOUT_MS ?? '120000');
const pollMs = Number(process.env.STORAGE_INIT_POLL_MS ?? '2000');

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
	const encodedKey = key
		.split('/')
		.filter(Boolean)
		.map(encodeURIComponent)
		.join('/');
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
	const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers.get(name).trim()}\n`).join('');
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
	const response = await s3('PUT');
	if (response.ok || response.status === 409) return;
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
	const started = Date.now();
	for (;;) {
		try {
			await createBucket();
			await smoke();
			console.log(`RustFS bucket "${bucket}" is ready at ${endpoint}.`);
			return;
		} catch (err) {
			if (Date.now() - started > timeoutMs) throw err;
			console.log(`Waiting for RustFS bucket "${bucket}": ${err.message}`);
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
