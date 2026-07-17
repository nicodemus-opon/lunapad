import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db';
import { ensureCloudJobsTableOnce } from '$lib/server/cloud-jobs';
import { getOllamaBaseUrl } from '$lib/server/embeddings';
import { getCloudExecutionAdapterHealth } from '$lib/server/cloud-execution';
import { insecureCloudEnv, requiredCloudEnv } from '$lib/server/cloud-readiness';
import { checkEmailHealth } from '$lib/server/email';
import { checkObjectStorageHealth } from '$lib/server/object-storage';
import { checkRedisHealth } from '$lib/server/redis-rate-limit';
import { deploymentMode } from '$lib/server/tenancy';

export type HealthCheckStatus = 'ok' | 'degraded' | 'missing' | 'failed';
export type HealthCheckFeature =
	| 'core'
	| 'workers'
	| 'external-connections'
	| 'publishing'
	| 'ai'
	| 'billing';

async function check(
	name: string,
	run: () => Promise<unknown>,
	opts: { required?: boolean; requiredBecause?: string; feature?: HealthCheckFeature } = {}
) {
	const started = Date.now();
	try {
		const result = await run();
		if (result === 'not_configured') {
			const status: HealthCheckStatus = opts.required ? 'missing' : 'degraded';
			return {
				name,
				ok: !opts.required,
				required: Boolean(opts.required),
				requiredBecause: opts.requiredBecause,
				feature: opts.feature,
				status,
				latencyMs: Date.now() - started,
				message: 'Not configured'
			};
		}
		return {
			name,
			ok: true,
			required: Boolean(opts.required),
			requiredBecause: opts.requiredBecause,
			feature: opts.feature,
			status: 'ok' as HealthCheckStatus,
			latencyMs: Date.now() - started
		};
	} catch (err) {
		const status: HealthCheckStatus = opts.required ? 'failed' : 'degraded';
		return {
			name,
			ok: !opts.required,
			required: Boolean(opts.required),
			requiredBecause: opts.requiredBecause,
			feature: opts.feature,
			status,
			latencyMs: Date.now() - started,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

function enabled(...names: string[]): boolean {
	return names.some((name) => process.env[name] === 'true' || process.env[name] === '1');
}

export function _healthFeatureRequirements(mode: string) {
	const cloud = mode === 'cloud';
	const queueExecutionRequired = cloud && process.env.CLOUD_EXECUTION_ADAPTER === 'queue';
	return {
		queueExecutionRequired,
		inngestRequired: enabled('CLOUD_SCHEDULES_ENABLED', 'INNGEST_REQUIRED'),
		externalConnectionsRequired: enabled(
			'EXTERNAL_CONNECTIONS_ENABLED',
			'CLOUD_EXTERNAL_CONNECTIONS_REQUIRED'
		),
		objectStorageRequired: enabled(
			'PUBLISHING_OBJECT_STORAGE_REQUIRED',
			'CLOUD_OBJECT_STORAGE_REQUIRED'
		) || (cloud && process.env.OBJECT_STORAGE_PROVIDER === 's3'),
		aiRequired: enabled('AI_ENABLED', 'LUNAPAD_AI_ENABLED', 'AI_PROVIDER_REQUIRED')
	};
}

export const GET: RequestHandler = async () => {
	const mode = deploymentMode();
	const {
		queueExecutionRequired,
		inngestRequired,
		externalConnectionsRequired,
		objectStorageRequired,
		aiRequired
	} = _healthFeatureRequirements(mode);
	const execution = getCloudExecutionAdapterHealth();
	const checks = await Promise.all([
		check(
			'cloudEnv',
			async () => {
				const missing = requiredCloudEnv();
				if (missing.length > 0) throw new Error(`Missing: ${missing.join(', ')}`);
				const insecure = insecureCloudEnv();
				if (insecure.length > 0) throw new Error(`Replace placeholder values: ${insecure.join(', ')}`);
			},
			{
				required: mode === 'cloud',
				requiredBecause: mode === 'cloud' ? 'cloud mode requires explicit production config' : undefined,
				feature: 'core'
			}
		),
		check('database', async () => query(`SELECT 1`), { required: true, feature: 'core' }),
		check('redis', async () => checkRedisHealth(), {
			required: mode === 'cloud',
			requiredBecause: mode === 'cloud' ? 'cloud rate limits require Redis' : undefined,
			feature: 'core'
		}),
		check('workerQueue', async () => ensureCloudJobsTableOnce(), {
			required: queueExecutionRequired,
			requiredBecause: queueExecutionRequired ? 'CLOUD_EXECUTION_ADAPTER=queue' : undefined,
			feature: 'workers'
		}),
		check(
			'workerToken',
			async () => {
				if (!process.env.CLOUD_WORKER_TOKEN) return 'not_configured';
			},
			{
				required: queueExecutionRequired,
				requiredBecause: queueExecutionRequired ? 'queued execution requires worker auth' : undefined,
				feature: 'workers'
			}
		),
		check(
			'inngest',
			async () => {
				if (!process.env.INNGEST_EVENT_KEY && !process.env.INNGEST_DEV) return 'not_configured';
			},
			{
				required: inngestRequired,
				requiredBecause: inngestRequired ? 'scheduled jobs are enabled' : undefined,
				feature: 'workers'
			}
		),
		check(
			'trino',
			async () => {
				if (!process.env.TRINO_HOST && !process.env.TRINO_URL) return 'not_configured';
			},
			{
				required: externalConnectionsRequired,
				requiredBecause: externalConnectionsRequired ? 'external connections are enabled' : undefined,
				feature: 'external-connections'
			}
		),
		check(
			'objectStorage',
			async () => checkObjectStorageHealth(),
			{
				required: objectStorageRequired,
				requiredBecause: objectStorageRequired ? 'published artifacts require object storage' : undefined,
				feature: 'publishing'
			}
		),
		check('email', async () => checkEmailHealth(), {
			required: mode === 'cloud' && process.env.EMAIL_PROVIDER === 'smtp',
			requiredBecause:
				mode === 'cloud' && process.env.EMAIL_PROVIDER === 'smtp'
					? 'cloud email delivery is enabled'
					: undefined,
			feature: 'core'
		}),
		check(
			'aiProvider',
			async () => {
				if (!process.env.OLLAMA_BASE_URL) return 'not_configured';
				const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
					signal: AbortSignal.timeout(1500)
				});
				if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
			},
			{
				required: aiRequired,
				requiredBecause: aiRequired ? 'AI is enabled' : undefined,
				feature: 'ai'
			}
		)
	]);
	const executionCheck = {
		name: 'executionAdapter',
		ok: execution.ok,
		required: execution.required,
		requiredBecause: execution.required ? 'cloud queue execution selected' : undefined,
		feature: 'workers' as HealthCheckFeature,
		status: execution.status,
		adapter: execution.adapter,
		message: execution.message
	};
	const allChecks = [...checks, executionCheck];
	const ok = allChecks.every((item) => item.ok);
	return json({ ok, mode, checks: allChecks }, { status: ok ? 200 : 503 });
};
