import { appendCloudJobLogs, getCloudJob, type CloudJob } from './cloud-jobs.js';
import { queryExternalConnection } from './connections.js';
import { getSecret } from './connection-secrets.js';
import { getConnectionMetadata, listConnectionsMetadata } from './connections-store.js';
import { spawnDbt } from './dbt-runner.js';
import {
	ensureProjectPinnedPackages,
	getPythonJob,
	spawnPythonCell,
	type PythonRunResult,
	type PythonTable,
	type PythonTableDescriptor
} from './python-runner.js';
import { readPinnedPackages } from './python-packages.js';

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

function waitForPythonJob(jobId: string, timeoutMs: number): Promise<PythonRunResult> {
	return new Promise((resolve, reject) => {
		const job = getPythonJob(jobId);
		if (!job) {
			reject(new Error('Python job not found immediately after spawning it.'));
			return;
		}
		if (job.done) {
			resolve(
				job.result ?? { error: 'No result', missingModule: null, figures: [], dataframe: null }
			);
			return;
		}
		const timer = setTimeout(() => {
			job.emitter.off('done', onDone);
			reject(new Error('Python cell execution timed out.'));
		}, timeoutMs);
		const onDone = () => {
			clearTimeout(timer);
			resolve(
				job.result ?? { error: 'No result', missingModule: null, figures: [], dataframe: null }
			);
		};
		job.emitter.once('done', onDone);
	});
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
		return queryExternalConnection(
			connection,
			secret ?? undefined,
			sql,
			undefined,
			job.orgId,
			availableConnections
		);
	}
	if (job.kind === 'dbt') {
		const folder = assertString(payload.folder, 'folder');
		const args = assertStringArray(payload.args, 'args');
		return { jobId: spawnDbt(args, folder) };
	}
	if (job.kind === 'python') {
		const notebookId = assertString(payload.notebookId, 'notebookId');
		const code = assertString(payload.code, 'code');
		const tables = (
			payload.tables && typeof payload.tables === 'object' ? payload.tables : {}
		) as Record<string, PythonTable>;
		const tableDescriptors = Array.isArray(payload.tableDescriptors)
			? (payload.tableDescriptors as PythonTableDescriptor[])
			: [];
		const folder =
			typeof payload.folder === 'string' && payload.folder ? payload.folder : undefined;
		if (folder) {
			// Mirror the submission-time sync in api/python/run/+server.ts: it's already
			// been called once for this folder before the job was enqueued, but that
			// happened on whichever app instance received the original HTTP request —
			// re-running it here (cheap no-op after the first time per folder) guarantees
			// pinned packages are present on whichever instance actually claims the job.
			const pins = await readPinnedPackages(folder);
			await ensureProjectPinnedPackages(folder, pins);
		}
		const pythonJobId = spawnPythonCell(notebookId, code, tables, tableDescriptors);
		const pythonJob = getPythonJob(pythonJobId);
		if (!pythonJob) throw new Error('Python job not found immediately after spawning it.');

		const logWrites: Promise<unknown>[] = [];
		const appendLine = (line: string): void => {
			logWrites.push(
				appendCloudJobLogs({
					orgId: job.orgId,
					jobId: job.id,
					workerId: input.workerId,
					message: `${line}\n`
				})
			);
		};
		for (const line of pythonJob.lines) appendLine(line);
		pythonJob.emitter.on('line', appendLine);
		try {
			const result = await waitForPythonJob(pythonJobId, job.timeoutMs);
			await Promise.allSettled(logWrites);
			return result;
		} finally {
			pythonJob.emitter.off('line', appendLine);
		}
	}
	throw new Error(`No production worker executor is registered for job kind "${job.kind}".`);
}
