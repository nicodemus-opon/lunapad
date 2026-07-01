import { query } from './db.js';

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
			user_id    TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
			settings   JSONB NOT NULL DEFAULT '{}',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
}

export function ensureUserSettingsTableOnce(): Promise<void> {
	if (!settingsTableReady) settingsTableReady = ensureUserSettingsTable();
	return settingsTableReady;
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
	await ensureUserSettingsTableOnce();
	const rows = await query<{ settings: UserSettings }>(
		`SELECT settings FROM user_settings WHERE user_id = $1`,
		[userId]
	);
	return rows[0]?.settings ?? {};
}

export async function updateUserSettings(
	userId: string,
	patch: Partial<UserSettings>
): Promise<UserSettings> {
	await ensureUserSettingsTableOnce();
	const current = await getUserSettings(userId);
	const merged: UserSettings = {
		...current,
		...patch,
		llmConfig: patch.llmConfig ? { ...current.llmConfig, ...patch.llmConfig } : current.llmConfig
	};
	await query(
		`INSERT INTO user_settings (user_id, settings, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = now()`,
		[userId, JSON.stringify(merged)]
	);
	return merged;
}
