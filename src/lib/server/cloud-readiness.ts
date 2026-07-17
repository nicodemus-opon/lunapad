import { deploymentMode } from './tenancy.js';
import { publicOrigin, publicOriginEnvPresent } from './cloud-config.js';

function missing(name: string): string | null {
	const value = process.env[name];
	return value && value.trim() ? null : name;
}

export function requiredCloudEnv(): string[] {
	if (deploymentMode() !== 'cloud') return [];
	const required = [
		'DATABASE_URL',
		'BETTER_AUTH_SECRET',
		'SECRETS_ENCRYPTION_KEY',
		'REDIS_URL',
		'CLOUD_WORKER_TOKEN'
	];
	if (process.env.CLOUD_EXECUTION_ADAPTER === 'queue') {
		required.push('CLOUD_QUEUE_WORKER_ENABLED');
	}
	if (process.env.EMAIL_PROVIDER === 'smtp') {
		required.push('SMTP_HOST', 'EMAIL_FROM');
	}
	if (process.env.OBJECT_STORAGE_PROVIDER === 's3') {
		required.push(
			'S3_ENDPOINT',
			'S3_BUCKET',
			'S3_ACCESS_KEY_ID',
			'S3_SECRET_ACCESS_KEY'
		);
	}
	const missingEnv = required.map(missing).filter((value): value is string => Boolean(value));
	if (!publicOriginEnvPresent()) {
		missingEnv.unshift('ORIGIN or SERVICE_URL_APP_3000/COOLIFY_URL');
	}
	return missingEnv;
}

export function assertCloudEnv(): void {
	const missingEnv = requiredCloudEnv();
	if (missingEnv.length > 0) {
		throw new Error(`Missing required cloud environment variables: ${missingEnv.join(', ')}`);
	}
	if (deploymentMode() === 'cloud' && process.env.PUBLIC_CLOUD_SIGNUP_ENABLED === 'true') {
		const limit = Number(process.env.SIGNUP_RATE_LIMIT_PER_HOUR ?? '20');
		if (!Number.isFinite(limit) || limit < 1) {
			throw new Error('SIGNUP_RATE_LIMIT_PER_HOUR must be a positive number.');
		}
	}
	if (
		deploymentMode() === 'cloud' &&
		process.env.CLOUD_EXECUTION_ADAPTER === 'queue' &&
		process.env.CLOUD_QUEUE_WORKER_ENABLED !== 'true' &&
		process.env.CLOUD_WORKER_ENABLED !== 'true'
	) {
		throw new Error('CLOUD_QUEUE_WORKER_ENABLED=true is required when CLOUD_EXECUTION_ADAPTER=queue.');
	}
}

export function insecureCloudEnv(): string[] {
	if (deploymentMode() !== 'cloud') return [];
	const origin = publicOrigin();
	if (origin.includes('localhost') || origin.includes('127.0.0.1')) return [];
	const insecure: string[] = [];
	for (const [name, value] of [
		['BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET],
		['SECRETS_ENCRYPTION_KEY', process.env.SECRETS_ENCRYPTION_KEY],
		['CLOUD_WORKER_TOKEN', process.env.CLOUD_WORKER_TOKEN]
	] as const) {
		if (!value || /change-me|local-secret|placeholder/i.test(value)) insecure.push(name);
	}
	return insecure;
}
