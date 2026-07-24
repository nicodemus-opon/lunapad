import { query } from './db.js';
import { DEFAULT_ORG_ID, DEFAULT_PROJECT_ID, ensureDefaultTenant } from './tenancy.js';

export type CloudJobKind =
	| 'query'
	| 'dbt'
	| 'python'
	| 'ai'
	| 'share_refresh'
	| 'notebook_execution'
	| 'git';

export type CloudJobStatus =
	| 'queued'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'timed_out';

export interface CloudJob {
	id: string;
	orgId: string;
	projectId: string | null;
	userId: string | null;
	kind: CloudJobKind;
	status: CloudJobStatus;
	timeoutMs: number;
	quotaKey: string | null;
	requestId: string | null;
	payload: Record<string, unknown> | null;
	logs: string | null;
	result: unknown | null;
	resultPointer: string | null;
	error: string | null;
	cancelRequestedAt: string | null;
	workerId: string | null;
	leaseExpiresAt: string | null;
	attempts: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface CloudJobClaim {
	orgId?: string | null;
	kind?: CloudJobKind | null;
	workerId: string;
	leaseMs?: number;
}

export interface CloudJobLease {
	job: CloudJob;
	leaseExpiresAt: string;
}

export interface CloudJobLogAppend {
	orgId?: string | null;
	jobId: string;
	message: string;
	workerId?: string | null;
	maxBytes?: number;
}

type CloudJobRow = {
	id: string;
	org_id: string;
	project_id: string | null;
	user_id: string | null;
	kind: string;
	status: string;
	timeout_ms: number;
	quota_key: string | null;
	request_id: string | null;
	payload?: Record<string, unknown> | null;
	logs?: string | null;
	result?: unknown | null;
	result_pointer?: string | null;
	error?: string | null;
	cancel_requested_at?: string | null;
	worker_id?: string | null;
	lease_expires_at?: string | null;
	attempts?: number | null;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	finished_at: string | null;
};

const CLOUD_JOB_COLUMNS = `
	id, org_id, project_id, user_id, kind, status, timeout_ms, quota_key,
	request_id, payload, logs, result, result_pointer, error, cancel_requested_at,
	worker_id, lease_expires_at, attempts, created_at, updated_at, started_at, finished_at
`;

const CLOUD_JOB_COLUMNS_FOR_ALIAS_J = `
	j.id, j.org_id, j.project_id, j.user_id, j.kind, j.status, j.timeout_ms, j.quota_key,
	j.request_id, j.payload, j.logs, j.result, j.result_pointer, j.error, j.cancel_requested_at,
	j.worker_id, j.lease_expires_at, j.attempts, j.created_at, j.updated_at, j.started_at, j.finished_at
`;

let cloudJobsTableReady: Promise<void> | null = null;

async function ensureCloudJobsTable(): Promise<void> {
	await ensureDefaultTenant();
	await query(`
		CREATE TABLE IF NOT EXISTS cloud_jobs (
			id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
			project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
			user_id     TEXT REFERENCES "user"("id") ON DELETE SET NULL,
			kind        TEXT NOT NULL,
			status      TEXT NOT NULL DEFAULT 'queued',
			timeout_ms  INTEGER NOT NULL,
			quota_key   TEXT,
			request_id  TEXT,
			payload     JSONB,
			logs        TEXT,
			result      JSONB,
			result_pointer TEXT,
			error       TEXT,
			cancel_requested_at TIMESTAMPTZ,
			worker_id   TEXT,
			lease_expires_at TIMESTAMPTZ,
			attempts    INTEGER NOT NULL DEFAULT 0,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
			started_at  TIMESTAMPTZ,
			finished_at TIMESTAMPTZ
		)
	`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS logs TEXT`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS result JSONB`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS result_pointer TEXT`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS worker_id TEXT`);
	await query(`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`);
	await query(
		`ALTER TABLE cloud_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS cloud_jobs_org_status_idx ON cloud_jobs (org_id, status)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS cloud_jobs_project_created_idx ON cloud_jobs (project_id, created_at DESC)`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS cloud_jobs_claim_idx ON cloud_jobs (status, lease_expires_at, created_at)`
	);
}

export function ensureCloudJobsTableOnce(): Promise<void> {
	if (!cloudJobsTableReady) cloudJobsTableReady = ensureCloudJobsTable();
	return cloudJobsTableReady;
}

function clampLeaseMs(leaseMs = 60_000): number {
	return Math.min(Math.max(leaseMs, 5_000), 3_600_000);
}

function toCloudJob(row: CloudJobRow): CloudJob {
	return {
		id: row.id,
		orgId: row.org_id,
		projectId: row.project_id,
		userId: row.user_id,
		kind: row.kind as CloudJobKind,
		status: row.status as CloudJobStatus,
		timeoutMs: row.timeout_ms,
		quotaKey: row.quota_key,
		requestId: row.request_id,
		payload: row.payload ?? null,
		logs: row.logs ?? null,
		result: row.result ?? null,
		resultPointer: row.result_pointer ?? null,
		error: row.error ?? null,
		cancelRequestedAt: row.cancel_requested_at ?? null,
		workerId: row.worker_id ?? null,
		leaseExpiresAt: row.lease_expires_at ?? null,
		attempts: row.attempts ?? 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at
	};
}

export async function createCloudJob(input: {
	orgId?: string | null;
	projectId?: string | null;
	userId?: string | null;
	kind: CloudJobKind;
	timeoutMs: number;
	quotaKey?: string | null;
	requestId?: string | null;
	payload?: Record<string, unknown> | null;
}): Promise<CloudJob> {
	await ensureCloudJobsTableOnce();
	const rows = await query<CloudJobRow>(
		`INSERT INTO cloud_jobs
		 (org_id, project_id, user_id, kind, timeout_ms, quota_key, request_id, payload)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[
			input.orgId ?? DEFAULT_ORG_ID,
			input.projectId ?? DEFAULT_PROJECT_ID,
			input.userId ?? null,
			input.kind,
			input.timeoutMs,
			input.quotaKey ?? null,
			input.requestId ?? null,
			input.payload ? JSON.stringify(input.payload) : null
		]
	);
	return toCloudJob(rows[0]);
}

export async function countActiveCloudJobs(orgId = DEFAULT_ORG_ID): Promise<number> {
	await ensureCloudJobsTableOnce();
	const rows = await query<{ count: string }>(
		`SELECT COUNT(*)::text AS count
		 FROM cloud_jobs
		 WHERE org_id = $1 AND status IN ('queued', 'running')`,
		[orgId]
	);
	return Number(rows[0]?.count ?? 0);
}

export async function listCloudJobs(input: {
	orgId?: string | null;
	projectId?: string | null;
	limit?: number;
}): Promise<CloudJob[]> {
	await ensureCloudJobsTableOnce();
	const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
	const rows = await query<CloudJobRow>(
		`SELECT ${CLOUD_JOB_COLUMNS}
		 FROM cloud_jobs
		 WHERE org_id = $1 AND ($2::text IS NULL OR project_id = $2)
		 ORDER BY created_at DESC
		 LIMIT $3`,
		[input.orgId ?? DEFAULT_ORG_ID, input.projectId ?? null, limit]
	);
	return rows.map(toCloudJob);
}

export async function getCloudJob(input: {
	orgId?: string | null;
	jobId: string;
}): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const rows = await query<CloudJobRow>(
		`SELECT ${CLOUD_JOB_COLUMNS}
		 FROM cloud_jobs
		 WHERE org_id = $1 AND id = $2`,
		[input.orgId ?? DEFAULT_ORG_ID, input.jobId]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function cancelCloudJob(input: {
	orgId?: string | null;
	jobId: string;
}): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const rows = await query<CloudJobRow>(
		`UPDATE cloud_jobs
		 SET status = 'cancelled',
		     cancel_requested_at = now(),
		     lease_expires_at = NULL,
		     updated_at = now(),
		     finished_at = COALESCE(finished_at, now())
		 WHERE org_id = $1 AND id = $2 AND status IN ('queued', 'running')
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[input.orgId ?? DEFAULT_ORG_ID, input.jobId]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function markCloudJobRunning(input: {
	orgId?: string | null;
	jobId: string;
}): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const rows = await query<CloudJobRow>(
		`UPDATE cloud_jobs
		 SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
		 WHERE org_id = $1 AND id = $2 AND status = 'queued'
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[input.orgId ?? DEFAULT_ORG_ID, input.jobId]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function finishCloudJob(input: {
	orgId?: string | null;
	jobId: string;
	workerId?: string | null;
	status: Extract<CloudJobStatus, 'succeeded' | 'failed' | 'timed_out' | 'cancelled'>;
	logs?: string | null;
	result?: unknown | null;
	resultPointer?: string | null;
	error?: string | null;
}): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const rows = await query<CloudJobRow>(
		`UPDATE cloud_jobs
		 SET status = $3,
		     logs = COALESCE($4, logs),
		     result = COALESCE($5::jsonb, result),
		     result_pointer = $6,
		     error = $7,
		     lease_expires_at = NULL,
		     updated_at = now(),
		     finished_at = now()
		 WHERE org_id = $1
		   AND id = $2
		   AND ($8::text IS NULL OR worker_id = $8)
		   AND status IN ('queued', 'running')
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[
			input.orgId ?? DEFAULT_ORG_ID,
			input.jobId,
			input.status,
			input.logs ?? null,
			input.result === undefined ? null : JSON.stringify(input.result),
			input.resultPointer ?? null,
			input.error ?? null,
			input.workerId ?? null
		]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function claimNextCloudJob(input: CloudJobClaim): Promise<CloudJobLease | null> {
	await ensureCloudJobsTableOnce();
	const leaseMs = clampLeaseMs(input.leaseMs);
	const rows = await query<CloudJobRow>(
		`WITH candidate AS (
			SELECT id
			FROM cloud_jobs
			WHERE ($1::text IS NULL OR org_id = $1)
			  AND ($2::text IS NULL OR kind = $2)
			  AND status = 'queued'
			  AND cancel_requested_at IS NULL
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE cloud_jobs j
		SET status = 'running',
		    worker_id = $3,
		    lease_expires_at = now() + ($4::int * interval '1 millisecond'),
		    attempts = attempts + 1,
		    started_at = COALESCE(started_at, now()),
		    updated_at = now()
		FROM candidate
		WHERE j.id = candidate.id
		RETURNING ${CLOUD_JOB_COLUMNS_FOR_ALIAS_J}`,
		[input.orgId ?? null, input.kind ?? null, input.workerId, leaseMs]
	);
	const job = rows[0] ? toCloudJob(rows[0]) : null;
	if (!job || !job.leaseExpiresAt) return null;
	return { job, leaseExpiresAt: job.leaseExpiresAt };
}

export async function appendCloudJobLogs(input: CloudJobLogAppend): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const maxBytes = Math.min(Math.max(input.maxBytes ?? 64_000, 1_000), 1_000_000);
	const rows = await query<CloudJobRow>(
		`UPDATE cloud_jobs
		 SET logs = right(COALESCE(logs, '') || $3, $4),
		     updated_at = now()
		 WHERE org_id = $1
		   AND id = $2
		   AND ($5::text IS NULL OR worker_id = $5)
		   AND status = 'running'
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[input.orgId ?? DEFAULT_ORG_ID, input.jobId, input.message, maxBytes, input.workerId ?? null]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function extendCloudJobLease(input: {
	orgId?: string | null;
	jobId: string;
	workerId: string;
	leaseMs?: number;
}): Promise<CloudJob | null> {
	await ensureCloudJobsTableOnce();
	const leaseMs = clampLeaseMs(input.leaseMs);
	const rows = await query<CloudJobRow>(
		`UPDATE cloud_jobs
		 SET lease_expires_at = now() + ($4::int * interval '1 millisecond'),
		     updated_at = now()
		 WHERE org_id = $1 AND id = $2 AND worker_id = $3 AND status = 'running'
		 RETURNING ${CLOUD_JOB_COLUMNS}`,
		[input.orgId ?? DEFAULT_ORG_ID, input.jobId, input.workerId, leaseMs]
	);
	return rows[0] ? toCloudJob(rows[0]) : null;
}

export async function failTimedOutCloudJobs(
	input: {
		// undefined (omitted) keeps the historical single-tenant default; pass
		// `orgId: null` explicitly to sweep every org's stuck jobs (see the
		// periodic cloud-job-reaper Inngest function, which needs exactly that —
		// a worker can die mid-job for any tenant, not just the default one).
		orgId?: string | null;
		limit?: number;
	} = {}
): Promise<CloudJob[]> {
	await ensureCloudJobsTableOnce();
	const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
	const orgId = input.orgId === undefined ? DEFAULT_ORG_ID : input.orgId;
	const rows = await query<CloudJobRow>(
		`WITH expired AS (
			SELECT id
			FROM cloud_jobs
			WHERE ($1::text IS NULL OR org_id = $1)
			  AND status = 'running'
			  AND (
			    lease_expires_at < now()
			    OR (started_at IS NOT NULL AND started_at + (timeout_ms::int * interval '1 millisecond') < now())
			  )
			ORDER BY updated_at ASC
			LIMIT $2
		)
		UPDATE cloud_jobs j
		SET status = 'timed_out',
		    error = COALESCE(error, 'Job timed out.'),
		    lease_expires_at = NULL,
		    updated_at = now(),
		    finished_at = now()
		FROM expired
		WHERE j.id = expired.id
		RETURNING ${CLOUD_JOB_COLUMNS_FOR_ALIAS_J}`,
		[orgId, limit]
	);
	return rows.map(toCloudJob);
}
