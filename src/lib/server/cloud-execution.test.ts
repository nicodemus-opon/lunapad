import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudJob } from './cloud-jobs.js';
import type { Entitlements } from './tenancy.js';

const mocks = vi.hoisted(() => ({
	createCloudJob: vi.fn(),
	finishCloudJob: vi.fn(),
	markCloudJobRunning: vi.fn(),
	assertConcurrentJobEntitlement: vi.fn(),
	assertCloudTenantRef: vi.fn(),
	deploymentMode: vi.fn()
}));

vi.mock('./cloud-jobs.js', () => ({
	createCloudJob: mocks.createCloudJob,
	finishCloudJob: mocks.finishCloudJob,
	markCloudJobRunning: mocks.markCloudJobRunning
}));

vi.mock('./entitlements.js', () => ({
	assertConcurrentJobEntitlement: mocks.assertConcurrentJobEntitlement
}));

vi.mock('./tenancy.js', () => ({
	assertCloudTenantRef: mocks.assertCloudTenantRef,
	deploymentMode: mocks.deploymentMode
}));

import { getCloudExecutionAdapter } from './cloud-execution.js';

const entitlements: Entitlements = {
	plan: 'team',
	maxProjects: 10,
	maxExternalConnections: 20,
	maxPublishedShares: 100,
	maxConcurrentJobs: 5,
	monthlyAiTokens: 1_000_000,
	maxSchedules: 25,
	maxApiRequestsPerMinute: 300,
	maxPublicShareRunsPerMinute: 120,
	maxStorageMb: 25_000
};

function job(overrides: Partial<CloudJob> = {}): CloudJob {
	return {
		id: 'job-1',
		orgId: 'org-1',
		projectId: 'project-1',
		userId: 'user-1',
		kind: 'query',
		status: 'queued',
		timeoutMs: 1000,
		quotaKey: null,
		requestId: null,
		payload: null,
		logs: null,
		resultPointer: null,
		error: null,
		cancelRequestedAt: null,
		workerId: null,
		leaseExpiresAt: null,
		attempts: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		startedAt: null,
		finishedAt: null,
		...overrides
	};
}

beforeEach(() => {
	vi.useRealTimers();
	delete process.env.CLOUD_EXECUTION_ADAPTER;
	delete process.env.CLOUD_QUEUE_WORKER_ENABLED;
	delete process.env.CLOUD_WORKER_ENABLED;
	mocks.createCloudJob.mockReset();
	mocks.finishCloudJob.mockReset();
	mocks.markCloudJobRunning.mockReset();
	mocks.assertConcurrentJobEntitlement.mockReset();
	mocks.assertCloudTenantRef.mockReset();
	mocks.deploymentMode.mockReset();
	mocks.deploymentMode.mockReturnValue('self_hosted');
});

describe('CloudExecutionAdapter', () => {
	it('fails closed when queue mode is selected without workers', async () => {
		process.env.CLOUD_EXECUTION_ADAPTER = 'queue';
		mocks.deploymentMode.mockReturnValue('cloud');

		const adapter = getCloudExecutionAdapter();
		await expect(
			adapter.submit({
				tenant: { orgId: 'org-1', projectId: 'project-1' },
				kind: 'query',
				timeoutMs: 1000,
				entitlements,
				run: async () => ({ ok: true })
			})
		).rejects.toThrow('Cloud queue execution is not configured');
		expect(mocks.createCloudJob).not.toHaveBeenCalled();
	});

	it('accepts queued jobs only when worker processing is explicitly enabled', async () => {
		process.env.CLOUD_EXECUTION_ADAPTER = 'queue';
		process.env.CLOUD_QUEUE_WORKER_ENABLED = 'true';
		mocks.deploymentMode.mockReturnValue('cloud');
		mocks.createCloudJob.mockResolvedValue(job());

		const adapter = getCloudExecutionAdapter();
		const result = await adapter.submit({
			tenant: { orgId: 'org-1', projectId: 'project-1' },
			kind: 'query',
			timeoutMs: 1000,
			entitlements,
			run: async () => ({ ok: true })
		});

		expect(result.queued).toBe(true);
		expect(mocks.assertConcurrentJobEntitlement).toHaveBeenCalledWith({
			orgId: 'org-1',
			entitlements
		});
		expect(mocks.createCloudJob).toHaveBeenCalledTimes(1);
	});

	it('marks inline jobs as timed out when execution exceeds the job timeout', async () => {
		vi.useFakeTimers();
		mocks.createCloudJob.mockResolvedValue(job());
		mocks.markCloudJobRunning.mockResolvedValue(job({ status: 'running' }));
		mocks.finishCloudJob.mockResolvedValue(job({ status: 'timed_out' }));

		const adapter = getCloudExecutionAdapter();
		const pending = adapter.submit({
			tenant: { orgId: 'org-1', projectId: 'project-1' },
			kind: 'query',
			timeoutMs: 5,
			entitlements,
			run: async () => new Promise(() => undefined)
		});
		const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });

		await vi.advanceTimersByTimeAsync(5);
		await assertion;
		expect(mocks.finishCloudJob).toHaveBeenCalledWith(
			expect.objectContaining({ jobId: 'job-1', status: 'timed_out' })
		);
	});

	it('aborts the inline runner signal when execution times out', async () => {
		vi.useFakeTimers();
		mocks.createCloudJob.mockResolvedValue(job());
		mocks.markCloudJobRunning.mockResolvedValue(job({ status: 'running' }));
		mocks.finishCloudJob.mockResolvedValue(job({ status: 'timed_out' }));
		let runnerSignal: AbortSignal | undefined;

		const adapter = getCloudExecutionAdapter();
		const pending = adapter.submit({
			tenant: { orgId: 'org-1', projectId: 'project-1' },
			kind: 'query',
			timeoutMs: 5,
			entitlements,
			run: async (_job, signal) => {
				runnerSignal = signal;
				return new Promise(() => undefined);
			}
		});
		const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });

		await vi.advanceTimersByTimeAsync(5);
		await assertion;
		expect(runnerSignal?.aborted).toBe(true);
		expect(runnerSignal?.reason).toMatchObject({ name: 'TimeoutError' });
	});
});
