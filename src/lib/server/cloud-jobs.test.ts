import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	ensureDefaultTenant: vi.fn()
}));

vi.mock('./db.js', () => ({
	query: mocks.query
}));

vi.mock('./tenancy.js', () => ({
	DEFAULT_ORG_ID: 'default-org',
	DEFAULT_PROJECT_ID: 'default-project',
	ensureDefaultTenant: mocks.ensureDefaultTenant
}));

import { finishCloudJob } from './cloud-jobs.js';

const row = {
	id: 'job-1',
	org_id: 'org-1',
	project_id: 'project-1',
	user_id: 'user-1',
	kind: 'query',
	status: 'succeeded',
	timeout_ms: 1000,
	quota_key: null,
	request_id: null,
	payload: null,
	logs: null,
	result_pointer: null,
	error: null,
	cancel_requested_at: null,
	worker_id: 'worker-1',
	lease_expires_at: null,
	attempts: 1,
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	started_at: new Date().toISOString(),
	finished_at: new Date().toISOString()
};

beforeEach(() => {
	mocks.query.mockReset();
	mocks.ensureDefaultTenant.mockReset();
	mocks.query.mockImplementation(async (sql: string) => {
		if (sql.includes('UPDATE cloud_jobs') && sql.includes('finished_at = now()')) return [row];
		return [];
	});
});

describe('cloud job storage invariants', () => {
	it('requires matching worker ownership when finishing a claimed job', async () => {
		await finishCloudJob({
			orgId: 'org-1',
			jobId: 'job-1',
			workerId: 'worker-1',
			status: 'succeeded'
		});

		const updateCall = mocks.query.mock.calls.find(([sql]) =>
			String(sql).includes('finished_at = now()')
		);
		expect(updateCall?.[0]).toContain('worker_id = $7');
		expect(updateCall?.[1]).toEqual([
			'org-1',
			'job-1',
			'succeeded',
			null,
			null,
			null,
			'worker-1'
		]);
	});
});
