import type { CloudJobStatus } from './cloud-jobs.js';

export type FinalCloudJobStatus = Extract<
	CloudJobStatus,
	'succeeded' | 'failed' | 'timed_out' | 'cancelled'
>;

const finalStatuses = new Set<FinalCloudJobStatus>([
	'succeeded',
	'failed',
	'timed_out',
	'cancelled'
]);

export function isFinalCloudJobStatus(
	status: CloudJobStatus | undefined
): status is FinalCloudJobStatus {
	return Boolean(status && finalStatuses.has(status as FinalCloudJobStatus));
}

/** Key/type shape of a finish payload for logs — never includes row data. */
export function finishPayloadShape(body: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value])
	);
}
