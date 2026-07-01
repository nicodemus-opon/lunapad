import crypto from 'node:crypto';
import { query } from './db.js';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import type { ShareCellSnapshot, SharePublishRole } from '$lib/services/share-snapshot';

export interface ShareSnapshot {
	cells: ShareCellSnapshot[];
	reportView: boolean;
}

export type ShareTheme = 'light' | 'dark' | 'system';

export interface ShareRecord {
	token: string;
	slug: string | null;
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs: number | null;
	requireAuth: boolean;
	theme: ShareTheme;
	description: string | null;
	expiresAt: string | null;
	currentVersion: number;
	revoked: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ShareVersionRecord {
	token: string;
	version: number;
	notebookName: string;
	createdAt: string;
}

const VERSION_RETENTION = 20;

const SLUG_PATTERN = /^[a-z0-9-]{3,64}$/;

export function isValidSlug(slug: string): boolean {
	return SLUG_PATTERN.test(slug);
}

/** Postgres unique_violation — see https://www.postgresql.org/docs/current/errcodes-appendix.html */
function isUniqueViolation(err: unknown): boolean {
	return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export interface ShareConnectionRecord {
	connectionId: string;
	connection: Connection;
	secret: ConnectionSecret | null;
}

export interface PublicShareCell {
	id: string;
	cellType: ShareCellSnapshot['cellType'];
	outputName: string;
	display: ShareCellSnapshot['display'];
	publishRole: SharePublishRole;
	language: ShareCellSnapshot['language'];
	markdown: string;
	isLive: boolean;
	frozenResult: ShareCellSnapshot['frozenResult'];
	resultChartConfig: ShareCellSnapshot['resultChartConfig'];
	resultViewMode: ShareCellSnapshot['resultViewMode'];
}

export interface PublicShareView {
	token: string;
	notebookName: string;
	description: string | null;
	theme: ShareTheme;
	reportView: boolean;
	pollIntervalMs: number | null;
	cells: PublicShareCell[];
}

/** Redacts a share record down to what's safe to send to an anonymous viewer — never sqlTemplate, connection, or secret. */
export function toPublicShareView(share: ShareRecord): PublicShareView {
	return {
		token: share.token,
		notebookName: share.notebookName,
		description: share.description,
		theme: share.theme,
		reportView: share.snapshot.reportView,
		pollIntervalMs: share.pollIntervalMs,
		cells: share.snapshot.cells.map((cell) => ({
			id: cell.id,
			cellType: cell.cellType,
			outputName: cell.outputName,
			display: cell.display,
			publishRole: cell.publishRole ?? 'visible',
			language: cell.language,
			markdown: cell.markdown,
			isLive: cell.isLive,
			frozenResult: cell.isLive ? null : cell.frozenResult,
			resultChartConfig: cell.resultChartConfig,
			resultViewMode: cell.resultViewMode
		}))
	};
}

export async function ensureSharedReportTables(): Promise<void> {
	try {
		await query(`
			CREATE TABLE IF NOT EXISTS shared_reports (
				token            TEXT PRIMARY KEY,
				slug             TEXT UNIQUE,
				notebook_id      TEXT NOT NULL UNIQUE,
				notebook_name    TEXT NOT NULL,
				snapshot         JSONB NOT NULL,
				poll_interval_ms INTEGER,
				require_auth     BOOLEAN NOT NULL DEFAULT FALSE,
				current_version  INTEGER NOT NULL DEFAULT 1,
				revoked          BOOLEAN NOT NULL DEFAULT FALSE,
				created_at       TIMESTAMPTZ DEFAULT NOW(),
				updated_at       TIMESTAMPTZ DEFAULT NOW()
			)
		`);
		await query(
			`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS require_auth BOOLEAN NOT NULL DEFAULT FALSE`
		);
		await query(`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE`);
		await query(
			`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1`
		);
		await query(`CREATE INDEX IF NOT EXISTS shared_reports_slug_idx ON shared_reports (slug)`);
		await query(`
			CREATE TABLE IF NOT EXISTS shared_report_connections (
				id            SERIAL PRIMARY KEY,
				token         TEXT NOT NULL REFERENCES shared_reports(token) ON DELETE CASCADE,
				connection_id TEXT NOT NULL,
				connection    JSONB NOT NULL,
				secret        JSONB,
				UNIQUE(token, connection_id)
			)
		`);
		await query(`
			CREATE TABLE IF NOT EXISTS shared_report_versions (
				id            SERIAL PRIMARY KEY,
				token         TEXT NOT NULL REFERENCES shared_reports(token) ON DELETE CASCADE ON UPDATE CASCADE,
				version       INTEGER NOT NULL,
				snapshot      JSONB NOT NULL,
				notebook_name TEXT NOT NULL,
				created_at    TIMESTAMPTZ DEFAULT NOW(),
				UNIQUE(token, version)
			)
		`);
		await query(
			`CREATE INDEX IF NOT EXISTS shared_report_versions_token_idx ON shared_report_versions (token, version DESC)`
		);
		await query(
			`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system'`
		);
		await query(`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS description TEXT`);
		await query(`ALTER TABLE shared_reports ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
		await query(`
			CREATE TABLE IF NOT EXISTS share_refresh_schedules (
				id              SERIAL PRIMARY KEY,
				notebook_id     TEXT NOT NULL UNIQUE REFERENCES shared_reports(notebook_id) ON DELETE CASCADE,
				interval_ms     INTEGER NOT NULL,
				last_run_at     TIMESTAMPTZ,
				enabled         BOOLEAN NOT NULL DEFAULT TRUE,
				created_at      TIMESTAMPTZ DEFAULT NOW()
			)
		`);
	} catch {
		// Postgres not available — silently skip
	}
}

function generateToken(): string {
	return crypto.randomBytes(18).toString('base64url');
}

interface SharedReportRow {
	token: string;
	slug: string | null;
	notebook_id: string;
	notebook_name: string;
	snapshot: ShareSnapshot;
	poll_interval_ms: number | null;
	require_auth: boolean;
	theme: ShareTheme;
	description: string | null;
	expires_at: string | null;
	current_version: number;
	revoked: boolean;
	created_at: string;
	updated_at: string;
}

function rowToRecord(row: SharedReportRow): ShareRecord {
	return {
		token: row.token,
		slug: row.slug,
		notebookId: row.notebook_id,
		notebookName: row.notebook_name,
		snapshot: row.snapshot,
		pollIntervalMs: row.poll_interval_ms,
		requireAuth: row.require_auth,
		theme: row.theme ?? 'system',
		description: row.description,
		expiresAt: row.expires_at,
		currentVersion: row.current_version,
		revoked: row.revoked,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function getShareByToken(token: string): Promise<ShareRecord | null> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(`SELECT * FROM shared_reports WHERE token = $1`, [
		token
	]).catch(() => []);
	return rows[0] ? rowToRecord(rows[0]) : null;
}

/** All non-revoked shares, for pickers like the site-builder's "add an existing report as a page". */
export async function listActiveShares(): Promise<ShareRecord[]> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(
		`SELECT * FROM shared_reports WHERE revoked = FALSE ORDER BY notebook_name`
	).catch(() => []);
	return rows.map(rowToRecord);
}

export async function getShareBySlug(slug: string): Promise<ShareRecord | null> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(`SELECT * FROM shared_reports WHERE slug = $1`, [
		slug
	]).catch(() => []);
	return rows[0] ? rowToRecord(rows[0]) : null;
}

/** Resolves a public route param that may be either the random token or a vanity slug. */
export async function getShareByTokenOrSlug(identifier: string): Promise<ShareRecord | null> {
	return (await getShareByToken(identifier)) ?? (await getShareBySlug(identifier));
}

export async function getShareByNotebookId(notebookId: string): Promise<ShareRecord | null> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(`SELECT * FROM shared_reports WHERE notebook_id = $1`, [
		notebookId
	]).catch(() => []);
	return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function getShareConnections(token: string): Promise<ShareConnectionRecord[]> {
	await ensureSharedReportTables();
	const rows = await query<{
		connection_id: string;
		connection: Connection;
		secret: ConnectionSecret | null;
	}>(`SELECT connection_id, connection, secret FROM shared_report_connections WHERE token = $1`, [
		token
	]).catch(() => []);
	return rows.map((r) => ({
		connectionId: r.connection_id,
		connection: r.connection,
		secret: r.secret
	}));
}

/** Upserts a share by notebookId, preserving the existing token (and slug) across re-publishes. */
export async function upsertShare(input: {
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs?: number | null;
	requireAuth?: boolean;
	slug?: string | null;
	connections: ShareConnectionRecord[];
}): Promise<ShareRecord> {
	await ensureSharedReportTables();

	const existing = await getShareByNotebookId(input.notebookId);
	const token = existing?.token ?? generateToken();
	const requireAuth = input.requireAuth ?? existing?.requireAuth ?? false;
	const slug = input.slug !== undefined ? input.slug : (existing?.slug ?? null);
	const nextVersion = (existing?.currentVersion ?? 0) + 1;
	if (slug !== null && !isValidSlug(slug)) {
		throw new Error('Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.');
	}

	try {
		await query(
			`INSERT INTO shared_reports (token, slug, notebook_id, notebook_name, snapshot, poll_interval_ms, require_auth, current_version, revoked, updated_at)
			 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, FALSE, NOW())
			 ON CONFLICT (notebook_id) DO UPDATE SET
			   slug             = EXCLUDED.slug,
			   notebook_name    = EXCLUDED.notebook_name,
			   snapshot         = EXCLUDED.snapshot,
			   poll_interval_ms = EXCLUDED.poll_interval_ms,
			   require_auth     = EXCLUDED.require_auth,
			   current_version  = EXCLUDED.current_version,
			   revoked          = FALSE,
			   updated_at       = NOW()`,
			[
				token,
				slug,
				input.notebookId,
				input.notebookName,
				JSON.stringify(input.snapshot),
				input.pollIntervalMs ?? null,
				requireAuth,
				nextVersion
			]
		);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}

	await query(
		`INSERT INTO shared_report_versions (token, version, snapshot, notebook_name) VALUES ($1, $2, $3::jsonb, $4)`,
		[token, nextVersion, JSON.stringify(input.snapshot), input.notebookName]
	);
	await query(`DELETE FROM shared_report_versions WHERE token = $1 AND version <= $2`, [
		token,
		nextVersion - VERSION_RETENTION
	]);

	await query(`DELETE FROM shared_report_connections WHERE token = $1`, [token]);
	for (const conn of input.connections) {
		await query(
			`INSERT INTO shared_report_connections (token, connection_id, connection, secret)
			 VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
			[
				token,
				conn.connectionId,
				JSON.stringify(conn.connection),
				conn.secret ? JSON.stringify(conn.secret) : null
			]
		);
	}

	const saved = await getShareByToken(token);
	if (!saved) throw new Error('Failed to save share');
	return saved;
}

/** Slug-only rename, without touching the snapshot/connections (no republish needed). */
export async function setShareSlug(notebookId: string, slug: string | null): Promise<ShareRecord> {
	await ensureSharedReportTables();
	if (slug !== null && !isValidSlug(slug)) {
		throw new Error('Slug must be 3-64 characters, lowercase letters, numbers, and hyphens only.');
	}
	try {
		await query(`UPDATE shared_reports SET slug = $1, updated_at = NOW() WHERE notebook_id = $2`, [
			slug,
			notebookId
		]);
	} catch (err) {
		if (isUniqueViolation(err)) throw new Error('That slug is already taken.');
		throw err;
	}
	const saved = await getShareByNotebookId(notebookId);
	if (!saved) throw new Error('No share exists for this notebook');
	return saved;
}

/** True if the slug is free (or already belongs to this notebook's own share). */
export async function isSlugAvailable(slug: string, notebookId?: string): Promise<boolean> {
	await ensureSharedReportTables();
	const existing = await getShareBySlug(slug);
	return !existing || existing.notebookId === notebookId;
}

interface SharedReportVersionRow {
	token: string;
	version: number;
	snapshot: ShareSnapshot;
	notebook_name: string;
	created_at: string;
}

export async function listShareVersions(token: string): Promise<ShareVersionRecord[]> {
	await ensureSharedReportTables();
	const rows = await query<Omit<SharedReportVersionRow, 'snapshot'>>(
		`SELECT token, version, notebook_name, created_at FROM shared_report_versions WHERE token = $1 ORDER BY version DESC`,
		[token]
	).catch(() => []);
	return rows.map((r) => ({
		token: r.token,
		version: r.version,
		notebookName: r.notebook_name,
		createdAt: r.created_at
	}));
}

/**
 * Rolls back to a prior version by republishing its snapshot as a brand-new version — e.g.
 * "roll back to v3" becomes v6, pointing at v3's content. Never mutates history in place, so
 * the version list stays an accurate, append-only record of every publish (including rollbacks).
 */
export async function rollbackShareToVersion(token: string, version: number): Promise<ShareRecord> {
	await ensureSharedReportTables();
	const share = await getShareByToken(token);
	if (!share) throw new Error('No share exists for this token');

	const rows = await query<SharedReportVersionRow>(
		`SELECT * FROM shared_report_versions WHERE token = $1 AND version = $2`,
		[token, version]
	).catch(() => []);
	const target = rows[0];
	if (!target) throw new Error('That version no longer exists.');

	const connections = await getShareConnections(token);
	return upsertShare({
		notebookId: share.notebookId,
		notebookName: target.notebook_name,
		snapshot: target.snapshot,
		pollIntervalMs: share.pollIntervalMs,
		requireAuth: share.requireAuth,
		slug: share.slug,
		connections
	});
}

export async function revokeShareByNotebookId(notebookId: string): Promise<void> {
	await ensureSharedReportTables();
	await query(
		`UPDATE shared_reports SET revoked = TRUE, updated_at = NOW() WHERE notebook_id = $1`,
		[notebookId]
	);
}

/**
 * Mints a fresh token for the notebook's current share. The row itself (and its version
 * history, via ON UPDATE CASCADE on shared_report_versions.token) is kept — only the PK
 * value changes — so visiting the old URL 404s (the old token no longer exists) without
 * losing publish history. Connections are cleared and reinserted under the new token since
 * that FK doesn't cascade on update (the original delete-then-reinsert behavior).
 */
export async function regenerateShareToken(notebookId: string): Promise<ShareRecord> {
	await ensureSharedReportTables();
	const existing = await getShareByNotebookId(notebookId);
	if (!existing) throw new Error('No share exists for this notebook');

	const connections = await getShareConnections(existing.token);
	const newToken = generateToken();

	await query(`DELETE FROM shared_report_connections WHERE token = $1`, [existing.token]);
	await query(`UPDATE shared_reports SET token = $1, updated_at = NOW() WHERE token = $2`, [
		newToken,
		existing.token
	]);
	await query(`UPDATE site_pages SET share_token = $1 WHERE share_token = $2`, [
		newToken,
		existing.token
	]);

	for (const conn of connections) {
		await query(
			`INSERT INTO shared_report_connections (token, connection_id, connection, secret)
			 VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
			[
				newToken,
				conn.connectionId,
				JSON.stringify(conn.connection),
				conn.secret ? JSON.stringify(conn.secret) : null
			]
		);
	}

	const saved = await getShareByToken(newToken);
	if (!saved) throw new Error('Failed to regenerate share');
	return saved;
}

/** Updates share metadata without bumping version or rebuilding the snapshot. */
export async function updateShareSettings(
	notebookId: string,
	input: {
		pollIntervalMs?: number | null;
		requireAuth?: boolean;
		expiresAt?: string | null;
		theme?: ShareTheme;
		description?: string | null;
	}
): Promise<ShareRecord> {
	await ensureSharedReportTables();
	const existing = await getShareByNotebookId(notebookId);
	if (!existing) throw new Error('No share exists for this notebook');

	const pollIntervalMs =
		input.pollIntervalMs !== undefined ? input.pollIntervalMs : existing.pollIntervalMs;
	const requireAuth = input.requireAuth !== undefined ? input.requireAuth : existing.requireAuth;
	const expiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;
	const theme = input.theme !== undefined ? input.theme : existing.theme;
	const description = input.description !== undefined ? input.description : existing.description;

	await query(
		`UPDATE shared_reports
		 SET poll_interval_ms = $1, require_auth = $2, expires_at = $3, theme = $4, description = $5, updated_at = NOW()
		 WHERE notebook_id = $6`,
		[pollIntervalMs, requireAuth, expiresAt, theme, description, notebookId]
	);

	const saved = await getShareByNotebookId(notebookId);
	if (!saved) throw new Error('Failed to update share settings');
	return saved;
}

export interface ShareRefreshSchedule {
	id: number;
	notebookId: string;
	intervalMs: number;
	lastRunAt: string | null;
	enabled: boolean;
}

export async function upsertShareRefreshSchedule(
	notebookId: string,
	intervalMs: number,
	enabled = true
): Promise<ShareRefreshSchedule> {
	await ensureSharedReportTables();
	const rows = await query<{
		id: number;
		notebook_id: string;
		interval_ms: number;
		last_run_at: string | null;
		enabled: boolean;
	}>(
		`INSERT INTO share_refresh_schedules (notebook_id, interval_ms, enabled)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (notebook_id) DO UPDATE SET interval_ms = EXCLUDED.interval_ms, enabled = EXCLUDED.enabled
		 RETURNING *`,
		[notebookId, intervalMs, enabled]
	);
	const row = rows[0];
	return {
		id: row.id,
		notebookId: row.notebook_id,
		intervalMs: row.interval_ms,
		lastRunAt: row.last_run_at,
		enabled: row.enabled
	};
}

export async function listDueRefreshSchedules(): Promise<ShareRefreshSchedule[]> {
	await ensureSharedReportTables();
	const rows = await query<{
		id: number;
		notebook_id: string;
		interval_ms: number;
		last_run_at: string | null;
		enabled: boolean;
	}>(
		`SELECT s.* FROM share_refresh_schedules s
		 JOIN shared_reports r ON r.notebook_id = s.notebook_id
		 WHERE s.enabled = TRUE AND r.revoked = FALSE
		   AND (s.last_run_at IS NULL OR s.last_run_at + (s.interval_ms || ' milliseconds')::interval < NOW())`
	).catch(() => []);
	return rows.map((row) => ({
		id: row.id,
		notebookId: row.notebook_id,
		intervalMs: row.interval_ms,
		lastRunAt: row.last_run_at,
		enabled: row.enabled
	}));
}

export async function markRefreshScheduleRun(notebookId: string): Promise<void> {
	await ensureSharedReportTables();
	await query(`UPDATE share_refresh_schedules SET last_run_at = NOW() WHERE notebook_id = $1`, [
		notebookId
	]);
}
