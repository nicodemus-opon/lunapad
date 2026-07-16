import { query } from './db.js';
import { DEFAULT_ORG_ID } from './tenancy.js';

let settingsTableReady: Promise<void> | null = null;

export interface UserLlmConfig {
	provider?: 'ollama' | 'openapi-compatible';
	baseUrl?: string;
	model?: string;
	apiKey?: string;
	completionModel?: string;
}

export interface UserSettings {
	llmConfig?: UserLlmConfig;
}

async function ensureUserSettingsTable(): Promise<void> {
	await query(`
		CREATE TABLE IF NOT EXISTS user_settings (
			org_id     TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}',
			user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
			settings   JSONB NOT NULL DEFAULT '{}',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (org_id, user_id)
		)
	`);
	await query(
		`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG_ID}'`
	);
	await query(
		`CREATE UNIQUE INDEX IF NOT EXISTS user_settings_org_user_idx ON user_settings (org_id, user_id)`
	);
}

export function ensureUserSettingsTableOnce(): Promise<void> {
	if (!settingsTableReady) settingsTableReady = ensureUserSettingsTable();
	return settingsTableReady;
}

export async function getUserSettings(
	userId: string,
	orgId = DEFAULT_ORG_ID
): Promise<UserSettings> {
	await ensureUserSettingsTableOnce();
	const rows = await query<{ settings: UserSettings }>(
		`SELECT settings FROM user_settings WHERE user_id = $1 AND org_id = $2`,
		[userId, orgId]
	);
	return rows[0]?.settings ?? {};
}

export async function updateUserSettings(
	userId: string,
	patch: Partial<UserSettings>,
	orgId = DEFAULT_ORG_ID
): Promise<UserSettings> {
	await ensureUserSettingsTableOnce();
	const current = await getUserSettings(userId, orgId);
	const merged: UserSettings = {
		...current,
		...patch,
		llmConfig: patch.llmConfig ? { ...current.llmConfig, ...patch.llmConfig } : current.llmConfig
	};
	await query(
		`INSERT INTO user_settings (org_id, user_id, settings, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (org_id, user_id) DO UPDATE SET settings = $3, updated_at = now()`,
		[orgId, userId, JSON.stringify(merged)]
	);
	return merged;
}
