import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

const ENV_KEYS = [
	'OBJECT_STORAGE_PROVIDER',
	'S3_ENDPOINT',
	'S3_BUCKET',
	'S3_ACCESS_KEY_ID',
	'AWS_ACCESS_KEY_ID',
	'RUSTFS_ACCESS_KEY',
	'S3_SECRET_ACCESS_KEY',
	'AWS_SECRET_ACCESS_KEY',
	'RUSTFS_SECRET_KEY',
	'S3_REGION',
	'S3_FORCE_PATH_STYLE',
	'S3_HEALTHCHECK_TTL_MS'
];

const savedEnv: Record<string, string | undefined> = {};

import { _resetObjectStorageHealthCache, checkObjectStorageHealth } from './object-storage';

function listResponse(): Response {
	return new Response(
		'<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
		{ status: 200 }
	);
}

function configureS3() {
	process.env.OBJECT_STORAGE_PROVIDER = 's3';
	process.env.S3_ENDPOINT = 'http://localhost:9000';
	process.env.S3_BUCKET = 'lunapad-artifacts';
	process.env.S3_ACCESS_KEY_ID = 'test-key';
	process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
}

beforeEach(() => {
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	vi.unstubAllGlobals();
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset();
	fetchMock.mockImplementation(() => Promise.resolve(listResponse()));
	_resetObjectStorageHealthCache();
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	_resetObjectStorageHealthCache();
});

describe('checkObjectStorageHealth', () => {
	it('returns not_configured without touching S3 when env is missing', async () => {
		expect(await checkObjectStorageHealth()).toBe('not_configured');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('uses a single read-only ListObjectsV2 call (no PUT/GET-object/DELETE)', async () => {
		configureS3();
		expect(await checkObjectStorageHealth()).toBe('ok');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		expect(init?.method).toBe('GET');
		const parsed = url instanceof URL ? url : new URL(String(url));
		expect(parsed.searchParams.get('list-type')).toBe('2');
		expect(parsed.searchParams.get('max-keys')).toBe('1');
		expect(parsed.searchParams.get('prefix')).toBe('health/');
	});

	it('caches ok results within the TTL so rapid health probes do not hit S3', async () => {
		configureS3();
		expect(await checkObjectStorageHealth()).toBe('ok');
		expect(await checkObjectStorageHealth()).toBe('ok');
		expect(await checkObjectStorageHealth()).toBe('ok');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('dedupes concurrent probes into a single S3 request', async () => {
		configureS3();
		const results = await Promise.all([
			checkObjectStorageHealth(),
			checkObjectStorageHealth(),
			checkObjectStorageHealth()
		]);
		expect(results).toEqual(['ok', 'ok', 'ok']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('throws on S3 errors and does not cache the failure', async () => {
		configureS3();
		fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
		await expect(checkObjectStorageHealth()).rejects.toThrow('403');
		// Next probe must retry S3 instead of serving a cached failure.
		fetchMock.mockResolvedValueOnce(listResponse());
		expect(await checkObjectStorageHealth()).toBe('ok');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
