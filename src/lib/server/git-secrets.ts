import crypto from 'node:crypto';
import { query } from './db.js';
import { DEFAULT_ORG_ID } from './tenancy.js';

const ALGORITHM = 'aes-256-gcm';

export interface GitCredentialSecret {
	authMethod: 'deploy-key' | 'pat';
	/** deploy-key: the ed25519 private key (PEM). Never sent back to the client. */
	privateKey?: string;
	/** deploy-key: the public key half — safe to display/return, kept alongside the
	 *  private key so it can be re-shown without regenerating the pair. */
	publicKey?: string;
	/** pat: the token itself. */
	token?: string;
	/** pat: some hosts (Azure DevOps, some GHE setups) require a username alongside the token. */
	username?: string;
}

function getEncryptionKey(): Buffer {
	const raw = process.env.SECRETS_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error('SECRETS_ENCRYPTION_KEY is not set — required to store git credentials.');
	}
	const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
	if (key.length !== 32) {
		throw new Error(
			'SECRETS_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hex value.'
		);
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
		CREATE TABLE IF NOT EXISTS git_credentials (
			org_id     TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			project_id TEXT NOT NULL,
			ciphertext TEXT NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, project_id)
		)
	`);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS git_credentials_org_project_idx ON git_credentials (org_id, project_id)`
	);
}

function ensureSecretsTableOnce(): Promise<void> {
	if (!secretsTableReady) secretsTableReady = ensureSecretsTable();
	return secretsTableReady;
}

export async function setGitCredential(
	projectId: string,
	secret: GitCredentialSecret,
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureSecretsTableOnce();
	const ciphertext = encrypt(JSON.stringify(secret));
	await query(
		`INSERT INTO git_credentials (org_id, project_id, ciphertext, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (org_id, project_id) DO UPDATE SET ciphertext = $3, updated_at = now()`,
		[orgId, projectId, ciphertext]
	);
}

export async function getGitCredential(
	projectId: string,
	orgId = DEFAULT_ORG_ID
): Promise<GitCredentialSecret | null> {
	await ensureSecretsTableOnce();
	const rows = await query<{ ciphertext: string }>(
		`SELECT ciphertext FROM git_credentials WHERE project_id = $1 AND org_id = $2`,
		[projectId, orgId]
	);
	if (rows.length === 0) return null;
	return JSON.parse(decrypt(rows[0].ciphertext)) as GitCredentialSecret;
}

export async function deleteGitCredential(
	projectId: string,
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureSecretsTableOnce();
	await query(`DELETE FROM git_credentials WHERE project_id = $1 AND org_id = $2`, [
		projectId,
		orgId
	]);
}
