import { getCloudJob, type CloudJob } from './cloud-jobs.js';
import { queryExternalConnection } from './connections.js';
import { getSecret } from './connection-secrets.js';
import { getConnectionMetadata, listConnectionsMetadata } from './connections-store.js';
import { spawnDbt } from './dbt-runner.js';
import { spawnPythonCell, type PythonTable, type PythonTableDescriptor } from './python-runner.js';

function assertString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
	return value;
}

function assertStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
		throw new Error(`${label} must be an array of strings.`);
	}
	return value;
}

export function queueWorkerSupportsKind(kind: CloudJob['kind']): boolean {
	if (kind === 'query' || kind === 'dbt' || kind === 'python') return true;
	return process.env.CLOUD_WORKER_EXPERIMENTAL_AGENT_JOBS === 'true';
}

export async function runClaimedCloudJob(input: {
	orgId: string;
	jobId: string;
	workerId: string;
}): Promise<unknown> {
	const job = await getCloudJob({ orgId: input.orgId, jobId: input.jobId });
	if (!job || job.status !== 'running' || job.workerId !== input.workerId) {
		throw new Error('Job is not currently claimed by this worker.');
	}
	const payload = job.payload ?? {};
	if (job.kind === 'query') {
		const connectionId = assertString(payload.connectionId, 'connectionId');
		const sql = assertString(payload.sql, 'sql');
		const connection = await getConnectionMetadata(connectionId, job.orgId);
		if (!connection) throw new Error('Unknown connection.');
		const secret = await getSecret(connection.id, job.orgId);
		const availableConnections = await listConnectionsMetadata(job.orgId, {
			includePhysicalCatalogName: true
		});
		return queryExternalConnection(connection, secret ?? undefined, sql, undefined, job.orgId, availableConnections);
	}
	if (job.kind === 'dbt') {
		const folder = assertString(payload.folder, 'folder');
		const args = assertStringArray(payload.args, 'args');
		return { jobId: spawnDbt(args, folder) };
	}
	if (job.kind === 'python') {
		const notebookId = assertString(payload.notebookId, 'notebookId');
		const code = assertString(payload.code, 'code');
		const tables = (payload.tables && typeof payload.tables === 'object' ? payload.tables : {}) as Record<
			string,
			PythonTable
		>;
		const tableDescriptors = Array.isArray(payload.tableDescriptors)
			? (payload.tableDescriptors as PythonTableDescriptor[])
			: [];
		return { jobId: spawnPythonCell(notebookId, code, tables, tableDescriptors) };
	}
	throw new Error(`No production worker executor is registered for job kind "${job.kind}".`);
}
