import crypto from 'node:crypto';
import { query } from './db.js';
import type { ConnectionSecret } from '$lib/types/connection';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
	const raw = process.env.SECRETS_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error('SECRETS_ENCRYPTION_KEY is not set — required to store connection secrets.');
	}
	const key = Buffer.from(raw, 'base64');
	if (key.length !== 32) {
		throw new Error('SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).');
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
			connection_id TEXT PRIMARY KEY,
			ciphertext    TEXT NOT NULL,
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
}

function ensureSecretsTableOnce(): Promise<void> {
	if (!secretsTableReady) secretsTableReady = ensureSecretsTable();
	return secretsTableReady;
}

export async function setSecret(connectionId: string, secret: ConnectionSecret): Promise<void> {
	await ensureSecretsTableOnce();
	const ciphertext = encrypt(JSON.stringify(secret));
	await query(
		`INSERT INTO connection_secrets (connection_id, ciphertext, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (connection_id) DO UPDATE SET ciphertext = $2, updated_at = now()`,
		[connectionId, ciphertext]
	);
}

export async function getSecret(connectionId: string): Promise<ConnectionSecret | null> {
	await ensureSecretsTableOnce();
	const rows = await query<{ ciphertext: string }>(
		`SELECT ciphertext FROM connection_secrets WHERE connection_id = $1`,
		[connectionId]
	);
	if (rows.length === 0) return null;
	return JSON.parse(decrypt(rows[0].ciphertext)) as ConnectionSecret;
}

export async function deleteSecret(connectionId: string): Promise<void> {
	await ensureSecretsTableOnce();
	await query(`DELETE FROM connection_secrets WHERE connection_id = $1`, [connectionId]);
}
