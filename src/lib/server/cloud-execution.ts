import {
	createCloudJob,
	finishCloudJob,
	markCloudJobRunning,
	type CloudJob,
	type CloudJobKind
} from './cloud-jobs.js';
import { assertConcurrentJobEntitlement } from './entitlements.js';
import {
	assertCloudTenantRef,
	deploymentMode,
	type Entitlements,
	type TenantRef
} from './tenancy.js';
import { queueWorkerSupportsKind } from './cloud-job-runner.js';

export interface CloudExecutionInput<T> {
	tenant: TenantRef;
	userId?: string | null;
	kind: CloudJobKind;
	timeoutMs: number;
	quotaKey?: string | null;
	requestId?: string | null;
	entitlements?: Entitlements | null;
	payload?: Record<string, unknown> | null;
	signal?: AbortSignal;
	run: (job: CloudJob, signal: AbortSignal) => Promise<T>;
}

export interface CloudExecutionResult<T> {
	job: CloudJob;
	result?: T;
	queued: boolean;
}

export interface CloudExecutionAdapter {
	name: 'inline' | 'queue';
	submit<T>(input: CloudExecutionInput<T>): Promise<CloudExecutionResult<T>>;
}

export interface CloudExecutionAdapterHealth {
	adapter: 'inline' | 'queue';
	ok: boolean;
	status: 'ok' | 'missing' | 'failed';
	required: boolean;
	message?: string;
}

function queueWorkersConfigured(): boolean {
	return (
		process.env.CLOUD_QUEUE_WORKER_ENABLED === 'true' ||
		process.env.CLOUD_WORKER_ENABLED === 'true'
	);
}

function requireEntitlements(input: CloudExecutionInput<unknown>): Entitlements {
	if (!input.entitlements) {
		throw new Error('Missing entitlements for tenant-scoped job submission.');
	}
	return input.entitlements;
}

async function enforceJobEntitlements(input: CloudExecutionInput<unknown>): Promise<void> {
	assertCloudTenantRef(input.tenant, `cloud job ${input.kind}`);
	await assertConcurrentJobEntitlement({
		orgId: input.tenant.orgId,
		entitlements: requireEntitlements(input)
	});
}

function timeoutError(timeoutMs: number): Error {
	const err = new Error(`Job timed out after ${timeoutMs}ms.`);
	err.name = 'TimeoutError';
	return err;
}

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const err = new Error('Job aborted.');
	err.name = 'AbortError';
	return err;
}

function linkAbortSignal(parent: AbortSignal | undefined, controller: AbortController): () => void {
	if (!parent) return () => undefined;
	const abort = () => controller.abort(parent.reason ?? abortError(parent));
	if (parent.aborted) {
		abort();
		return () => undefined;
	}
	parent.addEventListener('abort', abort, { once: true });
	return () => parent.removeEventListener('abort', abort);
}

async function runWithTimeout<T>(input: CloudExecutionInput<T>, job: CloudJob): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let cleanupAbortListener: () => void = () => undefined;
	const controller = new AbortController();
	try {
		cleanupAbortListener = linkAbortSignal(input.signal, controller);
		return await Promise.race([
			input.run(job, controller.signal),
			new Promise<T>((_, reject) => {
				const abort = () => reject(abortError(controller.signal));
				if (controller.signal.aborted) {
					abort();
					return;
				}
				controller.signal.addEventListener('abort', abort, { once: true });
				timeout = setTimeout(() => {
					const err = timeoutError(input.timeoutMs);
					controller.abort(err);
					reject(err);
				}, input.timeoutMs);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		cleanupAbortListener();
	}
}

class InlineExecutionAdapter implements CloudExecutionAdapter {
	readonly name = 'inline' as const;

	async submit<T>(input: CloudExecutionInput<T>): Promise<CloudExecutionResult<T>> {
		await enforceJobEntitlements(input);
		let job = await createCloudJob({
			orgId: input.tenant.orgId,
			projectId: input.tenant.projectId,
			userId: input.userId,
			kind: input.kind,
			timeoutMs: input.timeoutMs,
			quotaKey: input.quotaKey,
			requestId: input.requestId,
			payload: input.payload
		});
		job = (await markCloudJobRunning({ orgId: input.tenant.orgId, jobId: job.id })) ?? job;
		try {
			const result = await runWithTimeout(input, job);
			const finished = await finishCloudJob({
				orgId: input.tenant.orgId,
				jobId: job.id,
				status: 'succeeded'
			});
			if (!finished) throw Object.assign(new Error('Job was cancelled before completion.'), { job });
			return { job: finished, result, queued: false };
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Job failed.';
			const status = err instanceof Error && err.name === 'TimeoutError' ? 'timed_out' : 'failed';
			const failed =
				(await finishCloudJob({
					orgId: input.tenant.orgId,
					jobId: job.id,
					status,
					error: message
				})) ?? job;
			throw Object.assign(err instanceof Error ? err : new Error(message), { job: failed });
		}
	}
}

class QueueExecutionAdapter implements CloudExecutionAdapter {
	readonly name = 'queue' as const;

	async submit<T>(input: CloudExecutionInput<T>): Promise<CloudExecutionResult<T>> {
		if (!queueWorkersConfigured()) {
			throw new Error(
				'Cloud queue execution is not configured. Set CLOUD_QUEUE_WORKER_ENABLED=true only after workers can claim and execute jobs.'
			);
		}
		if (!queueWorkerSupportsKind(input.kind)) {
			throw new Error(
				`Cloud queue execution does not yet support "${input.kind}" jobs. Use inline execution or add a worker executor before enabling this job kind.`
			);
		}
		await enforceJobEntitlements(input);
		const job = await createCloudJob({
			orgId: input.tenant.orgId,
			projectId: input.tenant.projectId,
			userId: input.userId,
			kind: input.kind,
			timeoutMs: input.timeoutMs,
			quotaKey: input.quotaKey,
			requestId: input.requestId,
			payload: input.payload
		});
		return { job, queued: true };
	}
}

export function getCloudExecutionAdapter(): CloudExecutionAdapter {
	if (deploymentMode() === 'cloud' && process.env.CLOUD_EXECUTION_ADAPTER === 'queue') {
		return new QueueExecutionAdapter();
	}
	return new InlineExecutionAdapter();
}

export function getCloudExecutionAdapterHealth(): CloudExecutionAdapterHealth {
	const wantsQueue = deploymentMode() === 'cloud' && process.env.CLOUD_EXECUTION_ADAPTER === 'queue';
	if (!wantsQueue) {
		return {
			adapter: 'inline',
			ok: true,
			status: 'ok',
			required: false,
			message: 'Inline execution is active.'
		};
	}
	if (!queueWorkersConfigured()) {
		return {
			adapter: 'queue',
			ok: false,
			status: 'missing',
			required: true,
			message: 'Queue execution requested, but CLOUD_QUEUE_WORKER_ENABLED is not true.'
		};
	}
	return {
		adapter: 'queue',
		ok: true,
		status: 'ok',
		required: true,
		message: 'Queue execution is enabled for worker claim processing.'
	};
}
