import fs from 'node:fs/promises';
import path from 'node:path';
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

/** Largest result file the app will load into the job row (safety cap). */
export const MAX_RESULT_FILE_BYTES = 50 * 1024 * 1024;

export interface ResolvedFinishResult {
	/** undefined when the worker sent neither inline result nor pointer (unchanged). */
	result: unknown;
	fileBytes: number | null;
	/** Set when neither an inline result nor a readable pointer file was provided. */
	error: string | null;
}

/**
 * Resolve a worker finish result payload. Small results travel inline in the
 * POST body; large ones travel via resultPointer (a result.json the worker wrote
 * into the shared projects volume) because multi-MB POST bodies have been
 * observed arriving empty at the app. The pointer must resolve inside
 * `<projectsRoot>/.worker-scratch` — anything else is rejected as a traversal.
 */
export async function resolveFinishResult(input: {
	result: unknown;
	resultPointer?: string | null;
	projectsRoot: string;
}): Promise<ResolvedFinishResult> {
	if (input.result !== undefined) return { result: input.result, fileBytes: null, error: null };
	const pointer = typeof input.resultPointer === 'string' ? input.resultPointer : '';
	if (!pointer) return { result: input.result, fileBytes: null, error: null };
	const scratchDir = path.resolve(input.projectsRoot, '.worker-scratch');
	const target = path.resolve(pointer);
	if (target !== scratchDir && !target.startsWith(scratchDir + path.sep)) {
		return { result: null, fileBytes: null, error: `result pointer escapes ${scratchDir}` };
	}
	try {
		const stat = await fs.stat(target);
		if (!stat.isFile())
			return { result: null, fileBytes: null, error: 'result pointer is not a file' };
		if (stat.size > MAX_RESULT_FILE_BYTES) {
			return { result: null, fileBytes: null, error: `result file too large (${stat.size} bytes)` };
		}
		const raw = await fs.readFile(target, 'utf-8');
		return { result: JSON.parse(raw) as unknown, fileBytes: stat.size, error: null };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return {
			result: null,
			fileBytes: null,
			error: code === 'ENOENT' ? 'result file not found' : `result file unreadable (${code ?? err})`
		};
	}
}
