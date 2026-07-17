import crypto from 'node:crypto';
import { query } from './db.js';
import type { ConnectionSecret } from '$lib/types/connection';
import { DEFAULT_ORG_ID } from './tenancy.js';

const ALGORITHM = 'aes-256-gcm';

export function parseEncryptionKey(raw: string): Buffer {
	if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
	return Buffer.from(raw, 'base64');
}

function getEncryptionKey(): Buffer {
	const raw = process.env.SECRETS_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error('SECRETS_ENCRYPTION_KEY is not set — required to store connection secrets.');
	}
	const key = parseEncryptionKey(raw);
	if (key.length !== 32) {
		throw new Error('SECRETS_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hex value.');
	}
	return key;
}

function encrypt(plaintext: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(payload: string): string {
	const raw = Buffer.from(payload, 'base64');
	const iv = raw.subarray(0, 12);
	const authTag = raw.subarray(12, 28);
	const encrypted = raw.subarray(28);
	const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

let secretsTableReady: Promise<void> | null = null;

async function ensureSecretsTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS connection_secrets (
			org_id        TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			connection_id TEXT NOT NULL,
			ciphertext    TEXT NOT NULL,
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, connection_id)
		)
	`);
	await query(
		`ALTER TABLE connection_secrets ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(
		`CREATE INDEX IF NOT EXISTS connection_secrets_org_idx ON connection_secrets (org_id)`
	);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS connection_secrets_org_connection_idx ON connection_secrets (org_id, connection_id)`
	);
}

function ensureSecretsTableOnce(): Promise<void> {
	if (!secretsTableReady) secretsTableReady = ensureSecretsTable();
	return secretsTableReady;
}

export async function setSecret(
	connectionId: string,
	secret: ConnectionSecret,
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureSecretsTableOnce();
	const ciphertext = encrypt(JSON.stringify(secret));
	await query(
		`INSERT INTO connection_secrets (org_id, connection_id, ciphertext, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (org_id, connection_id) DO UPDATE SET ciphertext = $3, updated_at = now()`,
		[orgId, connectionId, ciphertext]
	);
}

export async function getSecret(
	connectionId: string,
	orgId = DEFAULT_ORG_ID
): Promise<ConnectionSecret | null> {
	await ensureSecretsTableOnce();
	const rows = await query<{ ciphertext: string }>(
		`SELECT ciphertext FROM connection_secrets WHERE connection_id = $1 AND org_id = $2`,
		[connectionId, orgId]
	);
	if (rows.length === 0) return null;
	return JSON.parse(decrypt(rows[0].ciphertext)) as ConnectionSecret;
}

export async function deleteSecret(connectionId: string, orgId = DEFAULT_ORG_ID): Promise<void> {
	await ensureSecretsTableOnce();
	await query(`DELETE FROM connection_secrets WHERE connection_id = $1 AND org_id = $2`, [
		connectionId,
		orgId
	]);
}
