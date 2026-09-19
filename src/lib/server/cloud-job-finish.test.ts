import { describe, expect, it } from 'vitest';
import { finishPayloadShape, isFinalCloudJobStatus } from './cloud-job-finish.js';
import type { CloudJobStatus } from './cloud-jobs.js';

describe('isFinalCloudJobStatus', () => {
	it.each(['succeeded', 'failed', 'timed_out', 'cancelled'] as const)('accepts %s', (status) => {
		expect(isFinalCloudJobStatus(status)).toBe(true);
	});

	it.each(['queued', 'running', 'success', 'error', '', undefined] as (
		| CloudJobStatus
		| undefined
	)[])('rejects %s', (status) => {
		expect(isFinalCloudJobStatus(status)).toBe(false);
	});
});

describe('finishPayloadShape', () => {
	it('maps keys to type names without leaking values', () => {
		expect(
			finishPayloadShape({ status: 'succeeded', result: { rows: [[1]] }, tags: ['a'] })
		).toEqual({ status: 'string', result: 'object', tags: 'array' });
	});
});
