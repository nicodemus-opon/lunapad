import { query } from './db.js';
import { DEFAULT_ORG_ID } from './tenancy.js';

export interface GitRemoteConfig {
	remoteUrl: string;
	defaultBranch: string;
	/** Label only — never a secret. Mirrors the auth method of the credential in git-secrets.ts. */
	authMethod: 'deploy-key' | 'pat' | null;
	updatedAt: string;
}

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS git_remote_config (
			org_id         TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			project_id     TEXT NOT NULL,
			remote_url     TEXT NOT NULL,
			default_branch TEXT NOT NULL DEFAULT 'main',
			auth_method    TEXT,
			updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, project_id)
		)
	`);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS git_remote_config_org_project_idx ON git_remote_config (org_id, project_id)`
	);
}

function ensureTableOnce(): Promise<void> {
	if (!tableReady) tableReady = ensureTable();
	return tableReady;
}

export async function setGitRemoteConfig(
	projectId: string,
	config: { remoteUrl: string; defaultBranch: string; authMethod: 'deploy-key' | 'pat' | null },
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureTableOnce();
	await query(
		`INSERT INTO git_remote_config (org_id, project_id, remote_url, default_branch, auth_method, updated_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 ON CONFLICT (org_id, project_id) DO UPDATE
		 SET remote_url = $3, default_branch = $4, auth_method = $5, updated_at = now()`,
		[orgId, projectId, config.remoteUrl, config.defaultBranch, config.authMethod]
	);
}

export async function getGitRemoteConfig(
	projectId: string,
	orgId = DEFAULT_ORG_ID
): Promise<GitRemoteConfig | null> {
	await ensureTableOnce();
	const rows = await query<{
		remote_url: string;
		default_branch: string;
		auth_method: string | null;
		updated_at: string;
	}>(
		`SELECT remote_url, default_branch, auth_method, updated_at
		 FROM git_remote_config WHERE project_id = $1 AND org_id = $2`,
		[projectId, orgId]
	);
	if (rows.length === 0) return null;
	const row = rows[0];
	return {
		remoteUrl: row.remote_url,
		defaultBranch: row.default_branch,
		authMethod: (row.auth_method as GitRemoteConfig['authMethod']) ?? null,
		updatedAt: row.updated_at
	};
}

export async function deleteGitRemoteConfig(
	projectId: string,
	orgId = DEFAULT_ORG_ID
): Promise<void> {
	await ensureTableOnce();
	await query(`DELETE FROM git_remote_config WHERE project_id = $1 AND org_id = $2`, [
		projectId,
		orgId
	]);
}
