import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const baseUrl = process.env.CLOUD_SMOKE_BASE_URL ?? 'http://127.0.0.1:3967';
const mailpitUrl = process.env.CLOUD_SMOKE_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const email = `aggressive-${stamp}@example.com`;
const password = 'AggressiveSmoke123!';
const cookieJar = new Map();

function log(message) {
	console.log(`[cloud-smoke] ${message}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function setCookies(headers) {
	const raw =
		typeof headers.getSetCookie === 'function'
			? headers.getSetCookie()
			: (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
	for (const header of raw) {
		for (const part of header.split(/,(?=[^;,]+=)/)) {
			const [pair] = part.split(';');
			const index = pair.indexOf('=');
			if (index > 0) cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
		}
	}
}

function cookieHeader() {
	return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(path, opts = {}) {
	const headers = new Headers(opts.headers ?? {});
	if (opts.json !== undefined) {
		headers.set('content-type', 'application/json');
		opts.body = JSON.stringify(opts.json);
	}
	if (opts.cookie !== false && cookieJar.size > 0) headers.set('cookie', cookieHeader());
	const res = await fetch(new URL(path, baseUrl), {
		...opts,
		headers,
		redirect: opts.redirect ?? 'follow'
	});
	setCookies(res.headers);
	const text = await res.text();
	let body = text;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		// Leave non-JSON response text as-is.
	}
	return { res, body, text };
}

async function compose(args, options = {}) {
	const baseArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.cloud.yml'];
	const { stdout, stderr } = await execFileAsync('docker', [...baseArgs, ...args], {
		maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024
	});
	if (stderr.trim()) process.stderr.write(stderr);
	return stdout;
}

function sqlQuote(value) {
	return String(value).replaceAll("'", "''");
}

async function queryJob(jobId) {
	const sql = `
		SELECT json_build_object(
			'id', id,
			'kind', kind,
			'status', status,
			'workerId', worker_id,
			'attempts', attempts,
			'resultPointer', result_pointer,
			'error', error,
			'logs', logs
		)::text
		FROM cloud_jobs
		WHERE id = '${sqlQuote(jobId)}'
	`;
	const out = await compose([
		'exec',
		'-T',
		'db',
		'psql',
		'-U',
		'lunapad',
		'-d',
		'lunapad',
		'-t',
		'-A',
		'-c',
		sql
	]);
	const line = out.trim();
	assert(line, `No cloud_jobs row found for ${jobId}`);
	return JSON.parse(line);
}

async function waitForJob(jobId, expectedStatus, timeoutMs = 90_000) {
	const start = Date.now();
	let latest;
	while (Date.now() - start < timeoutMs) {
		latest = await queryJob(jobId);
		if (latest.status === expectedStatus) return latest;
		if (expectedStatus !== 'failed' && ['failed', 'cancelled', 'timed_out'].includes(latest.status)) {
			throw new Error(`Job ${jobId} ended as ${latest.status}: ${latest.error ?? latest.logs ?? ''}`);
		}
		if (expectedStatus === 'failed' && ['succeeded', 'cancelled', 'timed_out'].includes(latest.status)) {
			throw new Error(`Expected job ${jobId} to fail, got ${latest.status}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 750));
	}
	throw new Error(`Timed out waiting for ${jobId}; latest=${JSON.stringify(latest)}`);
}

async function readWorkerFile(path) {
	return compose(['exec', '-T', 'worker', 'cat', path]);
}

async function pollMailpit(predicate, timeoutMs = 15_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const res = await fetch(`${mailpitUrl}/api/v1/messages`);
		const body = await res.json();
		const message = body.messages?.find(predicate);
		if (message) return message;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('Timed out waiting for Mailpit message.');
}

function extractToken(text) {
	const match = String(text).match(/token=([A-Za-z0-9_-]+)/);
	assert(match, `Could not find verification token in: ${text}`);
	return match[1];
}

async function submitQuery(connection, sql, runId) {
	const { res, body } = await request('/api/connections/query', {
		method: 'POST',
		json: { connection, sql, runId }
	});
	assert(res.status === 202, `Expected query enqueue 202, got ${res.status}: ${JSON.stringify(body)}`);
	return body.job.id;
}

async function submitQueryRaw(connection, sql, runId) {
	return request('/api/connections/query', {
		method: 'POST',
		json: { connection, sql, runId }
	});
}

async function submitPython(code, notebookId) {
	const { res, body } = await request('/api/python/run', {
		method: 'POST',
		json: { notebookId, code, tables: {}, tableDescriptors: [] }
	});
	assert(res.status === 202, `Expected python enqueue 202, got ${res.status}: ${JSON.stringify(body)}`);
	return body.job.id;
}

async function readPythonSse(jobId) {
	const { res, text } = await request(`/api/python/logs?jobId=${encodeURIComponent(jobId)}`);
	assert(res.ok, `Python logs failed ${res.status}: ${text}`);
	return text;
}

async function main() {
	log(`base=${baseUrl}`);

	const health = await request('/api/health', { cookie: false });
	assert(health.res.ok && health.body.ok, `Health failed: ${health.text}`);
	log('health ok');

	const signup = await request('/api/signup', {
		method: 'POST',
		json: {
			name: 'Aggressive Smoke',
			email,
			password,
			workspaceName: `Aggressive ${stamp}`,
			projectName: 'Aggressive Project'
		}
	});
	assert(signup.res.status === 201, `Signup failed ${signup.res.status}: ${signup.text}`);
	assert(signup.body.organization.plan === 'starter', 'Signup did not assign starter plan.');
	log(`signup ok org=${signup.body.organization.id}`);

	const duplicate = await request('/api/signup', {
		method: 'POST',
		json: {
			name: 'Duplicate Smoke',
			email,
			password,
			workspaceName: `Duplicate ${stamp}`,
			projectName: 'Duplicate Project'
		}
	});
	assert(duplicate.res.status === 400, `Duplicate signup should fail, got ${duplicate.res.status}`);
	log('duplicate signup rejected');

	const verificationMessage = await pollMailpit(
		(message) =>
			message.Subject === 'Verify your Lunapad email' &&
			message.To?.some((recipient) => recipient.Address === email)
	);
	const verifyToken = extractToken(verificationMessage.Snippet);
	const verify = await request(`/api/account/email/verify?token=${verifyToken}`, {
		redirect: 'manual'
	});
	assert([302, 303].includes(verify.res.status), `Email verify failed ${verify.res.status}: ${verify.text}`);
	log('email verification link accepted');

	const reset = await request('/api/account/password-reset/request', {
		method: 'POST',
		json: { email }
	});
	assert(reset.res.ok && reset.body.ok, `Password reset failed ${reset.res.status}: ${reset.text}`);
	await pollMailpit(
		(message) =>
			message.Subject === 'Reset your Lunapad password' &&
			message.To?.some((recipient) => recipient.Address === email)
	);
	log('password reset email delivered');

	const suffix = stamp.replace(/[^a-z0-9]/g, '').slice(0, 16);
	const connection = {
		id: `aggressive-pg-${suffix}`,
		name: `Aggressive Postgres ${suffix}`,
		type: 'postgres',
		catalogName: `aggressive_pg_${suffix}`,
		host: 'db',
		port: 5432,
		database: 'lunapad',
		username: 'lunapad',
		ssl: false
	};

	const sync = await request('/api/connections/sync', { method: 'POST', json: { connection } });
	assert(sync.res.ok, `Connection sync failed ${sync.res.status}: ${sync.text}`);
	const secret = await request('/api/connections/secret', {
		method: 'POST',
		json: { connectionId: connection.id, secret: { password: 'lunapad' } }
	});
	assert(secret.res.ok, `Secret save failed ${secret.res.status}: ${secret.text}`);
	const test = await request('/api/connections/test', {
		method: 'POST',
		json: { connection, secret: { password: 'lunapad' } }
	});
	assert(test.res.ok && test.body.ok, `Connection test failed ${test.res.status}: ${test.text}`);
	log('postgres connection registered and tested');

	const firstQueryWave = await Promise.all([
		submitQuery(
			connection,
			`SELECT schema_name FROM ${connection.catalogName}.information_schema.schemata ORDER BY schema_name LIMIT 5`,
			`aggressive-schema-${stamp}`
		),
		submitQuery(
			connection,
			`SELECT table_name FROM ${connection.catalogName}.information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 8`,
			`aggressive-tables-${stamp}`
		)
	]);

	const overflow = await submitQueryRaw(
		connection,
		`SELECT count(*) AS table_count FROM ${connection.catalogName}.information_schema.tables WHERE table_schema = 'public'`,
		`aggressive-overflow-${stamp}`
	);
	assert(
		overflow.res.status === 400 && /Plan limit reached/.test(overflow.body.error ?? ''),
		`Expected starter concurrency limit, got ${overflow.res.status}: ${JSON.stringify(overflow.body)}`
	);
	log('starter concurrent job limit enforced');

	const firstQueryResults = await Promise.all(firstQueryWave.map((jobId) => waitForJob(jobId, 'succeeded')));
	const remainingQueryJob = await submitQuery(
		connection,
		`SELECT count(*) AS table_count FROM ${connection.catalogName}.information_schema.tables WHERE table_schema = 'public'`,
		`aggressive-count-${stamp}`
	);
	const remainingQueryResults = [await waitForJob(remainingQueryJob, 'succeeded')];

	const firstPythonWave = await Promise.all([
		submitPython('print(sum(range(10)))', `aggressive-python-a-${stamp}`),
		submitPython('import math\nprint(math.factorial(6))', `aggressive-python-b-${stamp}`)
	]);
	const firstPythonResults = await Promise.all(
		firstPythonWave.map((jobId) => waitForJob(jobId, 'succeeded'))
	);
	const remainingPythonJob = await submitPython(
		'print("cloud-worker-ok")',
		`aggressive-python-c-${stamp}`
	);
	const remainingPythonResults = [await waitForJob(remainingPythonJob, 'succeeded')];

	const queryJobs = [...firstQueryWave, remainingQueryJob];
	const pythonJobs = [...firstPythonWave, remainingPythonJob];
	const successfulJobs = [
		...firstQueryResults,
		...remainingQueryResults,
		...firstPythonResults,
		...remainingPythonResults
	];

	const badQueryJob = await submitQuery(
		connection,
		`SELECT definitely_missing_column FROM ${connection.catalogName}.information_schema.schemata LIMIT 1`,
		`aggressive-bad-sql-${stamp}`
	);
	log(`ran ${queryJobs.length} sql, ${pythonJobs.length} python, and 1 expected failure`);

	const failedJob = await waitForJob(badQueryJob, 'failed');
	assert(/definitely_missing_column|cannot be resolved/i.test(failedJob.error ?? ''), failedJob.error);
	log('expected bad SQL failed with a useful error');

	for (const job of successfulJobs.filter((item) => item.kind === 'query')) {
		const result = JSON.parse(await readWorkerFile(job.resultPointer));
		assert(Array.isArray(result.rows), `Query result missing rows for ${job.id}`);
		assert(Array.isArray(result.columns), `Query result missing columns for ${job.id}`);
	}
	log('all queued SQL jobs produced result JSON');

	for (const job of successfulJobs.filter((item) => item.kind === 'python')) {
		const result = JSON.parse(await readWorkerFile(job.resultPointer));
		assert(typeof result.jobId === 'string', `Python queue result missing inner job id for ${job.id}`);
		const sse = await readPythonSse(result.jobId);
		assert(/"type":"done"/.test(sse), `Python job did not finish cleanly: ${sse}`);
	}
	log('all queued Python jobs produced done events');

	const finalHealth = await request('/api/health', { cookie: false });
	assert(finalHealth.res.ok && finalHealth.body.ok, `Final health failed: ${finalHealth.text}`);

	console.log(
		JSON.stringify(
			{
				ok: true,
				email,
				orgId: signup.body.organization.id,
				queryJobs,
				pythonJobs,
				badQueryJob,
				health: finalHealth.body.checks.map((check) => ({
					name: check.name,
					status: check.status,
					ok: check.ok
				}))
			},
			null,
			2
		)
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
