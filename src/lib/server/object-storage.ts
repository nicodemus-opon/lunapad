import crypto from 'node:crypto';

export interface StorageObject {
	key: string;
	body: string | Uint8Array;
	contentType?: string;
}

function accessKeyId(): string {
	return (
		process.env.S3_ACCESS_KEY_ID ||
		process.env.AWS_ACCESS_KEY_ID ||
		process.env.RUSTFS_ACCESS_KEY ||
		''
	);
}

function secretAccessKey(): string {
	return (
		process.env.S3_SECRET_ACCESS_KEY ||
		process.env.AWS_SECRET_ACCESS_KEY ||
		process.env.RUSTFS_SECRET_KEY ||
		''
	);
}

export function missingStorageEnv(): string[] {
	const missing: string[] = [];
	if (process.env.OBJECT_STORAGE_PROVIDER !== 's3') missing.push('OBJECT_STORAGE_PROVIDER');
	if (!process.env.S3_ENDPOINT) missing.push('S3_ENDPOINT');
	if (!process.env.S3_BUCKET) missing.push('S3_BUCKET');
	if (!accessKeyId()) missing.push('S3_ACCESS_KEY_ID');
	if (!secretAccessKey()) missing.push('S3_SECRET_ACCESS_KEY');
	return missing;
}

function storageConfigured(): boolean {
	return (
		process.env.OBJECT_STORAGE_PROVIDER === 's3' &&
		Boolean(process.env.S3_ENDPOINT) &&
		Boolean(process.env.S3_BUCKET) &&
		Boolean(accessKeyId()) &&
		Boolean(secretAccessKey())
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
		hmac(hmac(hmac(`AWS4${secretAccessKey()}`, dateStamp), region()), 's3'),
		'aws4_request'
	);
	const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
	headers.set(
		'authorization',
		`AWS4-HMAC-SHA256 Credential=${accessKeyId()}/${scope}, SignedHeaders=${signedHeaderNames.join(
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

export async function getObjectBytes(key: string): Promise<Uint8Array> {
	const response = await storageFetch('GET', key);
	if (!response.ok) throw new Error(`S3 get failed with ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

export async function headObject(
	key: string
): Promise<{ size: number; etag: string | null } | null> {
	const response = await storageFetch('HEAD', key);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`S3 head failed with ${response.status}`);
	return {
		size: Number(response.headers.get('content-length') ?? '0'),
		etag: response.headers.get('etag')
	};
}

export interface ListedObject {
	key: string;
	size: number;
}

function parseListXml(xml: string): { keys: ListedObject[]; nextToken: string | null } {
	const keys: ListedObject[] = [];
	const contentRe = /<Contents>([\s\S]*?)<\/Contents>/g;
	let match: RegExpExecArray | null;
	while ((match = contentRe.exec(xml)) !== null) {
		const block = match[1];
		const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
		const sizeMatch = /<Size>([\s\S]*?)<\/Size>/.exec(block);
		if (!keyMatch) continue;
		keys.push({ key: keyMatch[1], size: Number(sizeMatch?.[1] ?? '0') });
	}
	const truncated = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xml)?.[1] === 'true';
	const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null;
	return { keys, nextToken: truncated ? token : null };
}

/** List all keys under a prefix (ListObjectsV2, paginated). */
export async function listObjects(prefix: string): Promise<ListedObject[]> {
	if (!storageConfigured()) throw new Error('S3 object storage is not configured.');
	const out: ListedObject[] = [];
	let continuationToken: string | undefined;
	for (;;) {
		const base = endpointUrl('');
		// endpointUrl('') resolves to the bucket root; ListObjectsV2 operates there.
		base.searchParams.set('list-type', '2');
		base.searchParams.set('prefix', prefix);
		base.searchParams.set('max-keys', '1000');
		if (continuationToken) base.searchParams.set('continuation-token', continuationToken);
		const headers = signRequest({ method: 'GET', url: base, body: '' });
		const response = await fetch(base, { method: 'GET', headers });
		if (!response.ok) throw new Error(`S3 list failed with ${response.status}`);
		const { keys, nextToken } = parseListXml(await response.text());
		out.push(...keys);
		if (!nextToken) break;
		continuationToken = nextToken;
	}
	return out;
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
