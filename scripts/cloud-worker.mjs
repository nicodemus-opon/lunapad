import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.LUNAPAD_BASE_URL ?? process.env.ORIGIN ?? 'http://localhost:3967';
const workerToken = process.env.CLOUD_WORKER_TOKEN;
const workerId =
	process.env.CLOUD_WORKER_ID ??
	`worker-${os.hostname().replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${process.pid}`;
const concurrency = Math.max(1, Math.min(Number(process.env.CLOUD_WORKER_CONCURRENCY ?? '1'), 16));
const leaseMs = Math.max(15_000, Number(process.env.CLOUD_WORKER_LEASE_MS ?? '60000'));
const pollMs = Math.max(500, Number(process.env.CLOUD_WORKER_POLL_MS ?? '1500'));
const active = new Set();
let shuttingDown = false;

if (!workerToken) {
	console.error('CLOUD_WORKER_TOKEN is required.');
	process.exit(1);
}

function endpoint(pathname) {
	return new URL(pathname, baseUrl).toString();
}

async function api(pathname, body) {
	const res = await fetch(endpoint(pathname), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${workerToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) {
		const error = new Error(payload.error ?? `Worker API failed with ${res.status}`);
		error.status = res.status;
		error.payload = payload;
		throw error;
	}
	return payload;
}

async function appendLog(lease, message) {
	await api(new URL(lease.runner.logsUrl).pathname, {
		orgId: lease.job.orgId,
		workerId,
		message: `${new Date().toISOString()} ${message}\n`
	});
}

async function finish(lease, status, extra = {}) {
	await api(new URL(lease.runner.finishUrl).pathname, {
		orgId: lease.job.orgId,
		workerId,
		status,
		...extra
	});
}

async function heartbeatLoop(lease, signal) {
	while (!signal.aborted) {
		await new Promise((resolve) => setTimeout(resolve, Math.max(5_000, Math.floor(leaseMs / 3))));
		if (signal.aborted) break;
		try {
			await api(new URL(lease.runner.heartbeatUrl).pathname, {
				orgId: lease.job.orgId,
				workerId,
				leaseMs
			});
		} catch (err) {
			console.warn(`Heartbeat failed for ${lease.job.id}:`, err.message);
		}
	}
}

async function executeLease(lease) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error('Job timed out.')), lease.runner.timeoutMs);
	const heartbeat = heartbeatLoop(lease, controller.signal);
	const scratchPath = lease.runner.tenantScratchPath;
	try {
		await fs.mkdir(scratchPath, { recursive: true });
		await appendLog(lease, `claimed ${lease.job.kind} job ${lease.job.id}`);
		await appendLog(lease, `scratch: ${scratchPath}`);

		const result = await api(new URL(lease.runner.runUrl).pathname, {
			orgId: lease.job.orgId,
			workerId
		});
		const resultPath = path.join(scratchPath, 'result.json');
		await fs.writeFile(resultPath, JSON.stringify(result.result ?? null, null, 2));
		await appendLog(lease, `completed ${lease.job.kind} job ${lease.job.id}`);
		await finish(lease, 'succeeded', {
			logs: `Result written to ${resultPath}`,
			resultPointer: resultPath
		});
	} catch (err) {
		if (controller.signal.aborted) {
			await finish(lease, 'timed_out', { error: 'Job timed out before the runner completed.' });
		} else {
			await appendLog(lease, `failed: ${err instanceof Error ? err.message : String(err)}`).catch(
				() => {}
			);
			await finish(lease, 'failed', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	} finally {
		clearTimeout(timeout);
		controller.abort();
		await heartbeat.catch(() => {});
		active.delete(lease.job.id);
	}
}

async function claimOnce() {
	const body = await api('/api/jobs/worker/claim', { workerId, leaseMs });
	const lease = body.lease;
	if (!lease) return false;
	active.add(lease.job.id);
	void executeLease(lease).catch((err) => {
		active.delete(lease.job.id);
		console.error(`Worker execution crashed for ${lease.job.id}:`, err);
	});
	return true;
}

async function main() {
	console.log(`Lunapad worker ${workerId} polling ${baseUrl} with concurrency ${concurrency}`);
	while (!shuttingDown) {
		try {
			while (active.size < concurrency && (await claimOnce())) {
				// Drain immediately available work up to concurrency.
			}
		} catch (err) {
			console.warn('Worker poll failed:', err.message);
		}
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	while (active.size > 0) {
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

process.on('SIGINT', () => {
	shuttingDown = true;
});
process.on('SIGTERM', () => {
	shuttingDown = true;
});

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
