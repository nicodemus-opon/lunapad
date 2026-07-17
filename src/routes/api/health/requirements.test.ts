import { beforeEach, describe, expect, it } from 'vitest';
import { _healthFeatureRequirements } from './+server.js';

const envKeys = [
	'CLOUD_EXECUTION_ADAPTER',
	'CLOUD_SCHEDULES_ENABLED',
	'INNGEST_REQUIRED',
	'EXTERNAL_CONNECTIONS_ENABLED',
	'CLOUD_EXTERNAL_CONNECTIONS_REQUIRED',
	'PUBLISHING_OBJECT_STORAGE_REQUIRED',
	'CLOUD_OBJECT_STORAGE_REQUIRED',
	'OLLAMA_BASE_URL',
	'AI_ENABLED',
	'LUNAPAD_AI_ENABLED',
	'OBJECT_STORAGE_PROVIDER'
];

beforeEach(() => {
	for (const key of envKeys) delete process.env[key];
});

describe('health feature requirements', () => {
	it('does not make every optional provider required just because deployment mode is cloud', () => {
		expect(_healthFeatureRequirements('cloud')).toMatchObject({
			queueExecutionRequired: false,
			inngestRequired: false,
			externalConnectionsRequired: false,
			objectStorageRequired: false,
			aiRequired: false
		});
	});

	it('requires worker readiness only when cloud queue execution is selected', () => {
		process.env.CLOUD_EXECUTION_ADAPTER = 'queue';
		expect(_healthFeatureRequirements('cloud').queueExecutionRequired).toBe(true);
		expect(_healthFeatureRequirements('self_hosted').queueExecutionRequired).toBe(false);
	});

	it('requires optional backends only when their features are explicitly enabled', () => {
		process.env.EXTERNAL_CONNECTIONS_ENABLED = 'true';
		process.env.PUBLISHING_OBJECT_STORAGE_REQUIRED = '1';
		process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
		process.env.AI_ENABLED = 'true';

		expect(_healthFeatureRequirements('cloud')).toMatchObject({
			externalConnectionsRequired: true,
			objectStorageRequired: true,
			aiRequired: true
		});
	});

	it('does not require AI just because a default provider URL is present', () => {
		process.env.OLLAMA_BASE_URL = 'http://host.docker.internal:11434';

		expect(_healthFeatureRequirements('self_hosted').aiRequired).toBe(false);
		expect(_healthFeatureRequirements('cloud').aiRequired).toBe(false);
	});

	it('requires object storage in cloud mode when S3 storage is selected', () => {
		process.env.OBJECT_STORAGE_PROVIDER = 's3';
		expect(_healthFeatureRequirements('cloud').objectStorageRequired).toBe(true);
		expect(_healthFeatureRequirements('self_hosted').objectStorageRequired).toBe(false);
	});
});
