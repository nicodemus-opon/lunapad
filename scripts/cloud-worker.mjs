import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.LUNAPAD_BASE_URL ?? process.env.ORIGIN ?? 'http://localhost:3967';
const workerToken = process.env.CLOUD_WORKER_TOKEN;
const workerId =
	process.env.CLOUD_WORKER_ID ??
	`worker-${os
		.hostname()
		.replace(/[^a-z0-9-]/gi, '-')
		.toLowerCase()}-${process.pid}`;
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

// Worker-internal trace (claim/scratch/completion bookkeeping) — goes to this
// process's own stdout (`docker compose logs worker`), never into the job's
// `logs` field. That field is streamed verbatim to the browser as a Python
// cell's live output (see /api/python/logs), so operational noise there would
// show up mixed in with the user's actual print() output.
function trace(lease, message) {
	console.log(`${new Date().toISOString()} [${lease.job.id}] ${message}`);
}

async function finish(lease, status, extra = {}) {
	// The finish call is the only thing standing between a completed job and a
	// terminal state — a transient 5xx here strands the job as running/queued
	// forever (and the client polls until timeout). Retry with backoff, then let
	// the error propagate so it is logged instead of failing silently.
	// A 400 is NOT transient (the identical body would fail identically), so fail
	// fast and surface the endpoint's diagnostics instead of burning 4 attempts.
	const attempts = 4;
	const payload = {
		orgId: lease.job.orgId,
		workerId,
		status,
		...extra
	};
	let serialized;
	try {
		serialized = JSON.stringify(payload);
	} catch (err) {
		trace(
			lease,
			`finish ${status} payload is not JSON-serializable (keys ${Object.keys(payload).join(',')}): ${err.message}`
		);
		throw err;
	}
	trace(
		lease,
		`finish ${status} payload: ${serialized.length} chars, keys ${Object.keys(payload).join(',')}`
	);
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			await api(new URL(lease.runner.finishUrl).pathname, JSON.parse(serialized));
			if (attempt > 1) trace(lease, `finish ${status} succeeded on attempt ${attempt}`);
			return;
		} catch (err) {
			lastError = err;
			const detail = err.payload ? ` ${JSON.stringify(err.payload).slice(0, 500)}` : '';
			trace(
				lease,
				`finish ${status} attempt ${attempt}/${attempts} failed: ${err.message}${detail}`
			);
			if (err.status === 400) break;
			if (attempt < attempts) await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
	}
	throw lastError;
}

async function heartbeatLoop(lease, signal, onJobGone) {
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
			if (err.status === 404) {
				// Job was cancelled or reaped server-side — stop the run so a
				// cancelled Trino query is actually killed instead of running to
				// completion and then failing its finish call.
				onJobGone?.();
				break;
			}
			console.warn(`Heartbeat failed for ${lease.job.id}:`, err.message);
		}
	}
}

async function executeLease(lease) {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error('Job timed out.')),
		lease.runner.timeoutMs
	);
	const heartbeat = heartbeatLoop(lease, controller.signal, () =>
		controller.abort(new Error('Job settled server-side.'))
	);
	const scratchPath = lease.runner.tenantScratchPath;
	try {
		await fs.mkdir(scratchPath, { recursive: true });
		trace(lease, `claimed ${lease.job.kind} job`);
		trace(lease, `scratch: ${scratchPath}`);

		const result = await api(new URL(lease.runner.runUrl).pathname, {
			orgId: lease.job.orgId,
			workerId
		});
		// The finish POST has proven unable to carry multi-MB bodies end to end
		// (a ~1.5MB result arrived as an empty body and was rejected), while the
		// result file below travels over the shared /app/projects volume instead.
		// Send the result inline only when small; the app resolves larger results
		// from resultPointer. The file is always written either way.
		const INLINE_RESULT_LIMIT = 256_000;
		const resultPath = path.join(scratchPath, 'result.json');
		const resultJson = JSON.stringify(result.result ?? null);
		await fs.writeFile(resultPath, JSON.stringify(result.result ?? null, null, 2));
		trace(lease, `completed ${lease.job.kind} job`);
		trace(lease, `result: ${resultPath} (${resultJson.length} chars)`);
		await finish(
			lease,
			'succeeded',
			resultJson.length <= INLINE_RESULT_LIMIT
				? {
						result: JSON.parse(resultJson),
						resultPointer: resultPath,
						resultBytes: resultJson.length
					}
				: { resultPointer: resultPath, resultBytes: resultJson.length }
		);
	} catch (err) {
		if (
			controller.signal.aborted &&
			controller.signal.reason?.message === 'Job settled server-side.'
		) {
			// Heartbeat 404: user cancelled or reaper timed out — the server already
			// owns the terminal state, so finishing would 404. Skip it quietly.
			trace(lease, 'job settled server-side (cancelled or reaped); skipping finish');
			return;
		}
		if (controller.signal.aborted) {
			await finish(lease, 'timed_out', { error: 'Job timed out before the runner completed.' });
		} else {
			trace(lease, `failed: ${err instanceof Error ? err.message : String(err)}`);
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
	// Fail fast with an actionable message when the worker token is rejected: a
	// 401/403 here means CLOUD_WORKER_TOKEN differs between the worker and app
	// services (common on Coolify when env vars are set per-service), and every
	// subsequent poll would fail the same way while jobs pile up unclaimed.
	try {
		await api('/api/jobs/worker/claim', { workerId, leaseMs });
	} catch (err) {
		if (err.status === 401 || err.status === 403) {
			console.error(
				`Worker auth rejected (HTTP ${err.status}): CLOUD_WORKER_TOKEN does not match the app service. ` +
					'Set the same token on both services and redeploy.'
			);
			process.exit(1);
		}
		if (err.status === 503) {
			console.error(
				'Worker auth unavailable (HTTP 503): CLOUD_WORKER_TOKEN is not configured on the app service. ' +
					'Set it on both services and redeploy.'
			);
			process.exit(1);
		}
		console.warn('Worker initial poll failed (will retry):', err.message);
	}
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
