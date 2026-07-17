import crypto from 'node:crypto';

export interface StorageObject {
	key: string;
	body: string | Uint8Array;
	contentType?: string;
}

function storageConfigured(): boolean {
	return Boolean(
		process.env.OBJECT_STORAGE_PROVIDER === 's3' &&
		process.env.S3_ENDPOINT &&
		process.env.S3_BUCKET &&
		process.env.S3_ACCESS_KEY_ID &&
		process.env.S3_SECRET_ACCESS_KEY
	);
}

function region(): string {
	return process.env.S3_REGION || 'us-east-1';
}

function endpointUrl(key = ''): URL {
	const endpoint = process.env.S3_ENDPOINT!;
	const bucket = process.env.S3_BUCKET!;
	const base = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
	if (process.env.S3_FORCE_PATH_STYLE !== 'false') {
		base.pathname = `${base.pathname.replace(/\/$/, '')}/${bucket}/${key
			.split('/')
			.map(encodeURIComponent)
			.join('/')}`;
		return base;
	}
	base.hostname = `${bucket}.${base.hostname}`;
	base.pathname = `/${key.split('/').map(encodeURIComponent).join('/')}`;
	return base;
}

function hashHex(value: string | Uint8Array): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key: crypto.BinaryLike, value: string): Buffer {
	return crypto.createHmac('sha256', key).update(value).digest();
}

function isoStamp(date: Date): { amzDate: string; dateStamp: string } {
	const raw = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
	return { amzDate: raw, dateStamp: raw.slice(0, 8) };
}

function signRequest(input: {
	method: string;
	url: URL;
	body: string | Uint8Array;
	contentType?: string;
}): Headers {
	const now = new Date();
	const { amzDate, dateStamp } = isoStamp(now);
	const payloadHash = hashHex(input.body);
	const headers = new Headers();
	headers.set('host', input.url.host);
	headers.set('x-amz-content-sha256', payloadHash);
	headers.set('x-amz-date', amzDate);
	if (input.contentType) headers.set('content-type', input.contentType);
	const signedHeaderNames = Array.from(headers.keys()).sort();
	const canonicalHeaders = signedHeaderNames
		.map((name) => `${name}:${headers.get(name)!.trim()}\n`)
		.join('');
	const canonicalQuery = Array.from(input.url.searchParams.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&');
	const canonicalRequest = [
		input.method,
		input.url.pathname,
		canonicalQuery,
		canonicalHeaders,
		signedHeaderNames.join(';'),
		payloadHash
	].join('\n');
	const scope = `${dateStamp}/${region()}/s3/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hashHex(canonicalRequest)].join('\n');
	const signingKey = hmac(
		hmac(hmac(hmac(`AWS4${process.env.S3_SECRET_ACCESS_KEY!}`, dateStamp), region()), 's3'),
		'aws4_request'
	);
	const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	headers.set(
		'authorization',
		`AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaderNames.join(
			';'
		)}, Signature=${signature}`
	);
	return headers;
}

async function storageFetch(
	method: string,
	key: string,
	body: string | Uint8Array = '',
	contentType?: string
) {
	if (!storageConfigured()) throw new Error('S3 object storage is not configured.');
	const url = endpointUrl(key);
	const headers = signRequest({ method, url, body, contentType });
	const requestBody =
		method === 'GET' || method === 'HEAD'
			? undefined
			: body instanceof Uint8Array
				? Uint8Array.from(body).buffer
				: body;
	return fetch(url, { method, headers, body: requestBody });
}

export async function putObject(input: StorageObject): Promise<string> {
	const response = await storageFetch('PUT', input.key, input.body, input.contentType);
	if (!response.ok) throw new Error(`S3 put failed with ${response.status}`);
	return input.key;
}

export async function getObjectText(key: string): Promise<string> {
	const response = await storageFetch('GET', key);
	if (!response.ok) throw new Error(`S3 get failed with ${response.status}`);
	return response.text();
}

export async function deleteObject(key: string): Promise<void> {
	const response = await storageFetch('DELETE', key);
	if (!response.ok && response.status !== 404)
		throw new Error(`S3 delete failed with ${response.status}`);
}

export async function checkObjectStorageHealth(): Promise<'ok' | 'not_configured'> {
	if (!storageConfigured()) return 'not_configured';
	const key = `health/${crypto.randomUUID()}.txt`;
	await putObject({ key, body: 'ok', contentType: 'text/plain; charset=utf-8' });
	const value = await getObjectText(key);
	await deleteObject(key);
	if (value !== 'ok') throw new Error('S3 health object round-trip returned unexpected content.');
	return 'ok';
}
