import crypto from 'node:crypto';
import { query } from './db.js';
import type { Connection, ConnectionSecret } from '$lib/types/connection';
import type { ShareCellSnapshot } from '$lib/services/share-snapshot';

export interface ShareSnapshot {
	cells: ShareCellSnapshot[];
	reportView: boolean;
}

export interface ShareRecord {
	token: string;
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs: number | null;
	revoked: boolean;
	createdAt: string;
	updatedAt: string;
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
	reportView: boolean;
	pollIntervalMs: number | null;
	cells: PublicShareCell[];
}

/** Redacts a share record down to what's safe to send to an anonymous viewer — never sqlTemplate, connection, or secret. */
export function toPublicShareView(share: ShareRecord): PublicShareView {
	return {
		token: share.token,
		notebookName: share.notebookName,
		reportView: share.snapshot.reportView,
		pollIntervalMs: share.pollIntervalMs,
		cells: share.snapshot.cells.map((cell) => ({
			id: cell.id,
			cellType: cell.cellType,
			outputName: cell.outputName,
			display: cell.display,
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
				notebook_id      TEXT NOT NULL UNIQUE,
				notebook_name    TEXT NOT NULL,
				snapshot         JSONB NOT NULL,
				poll_interval_ms INTEGER,
				revoked          BOOLEAN NOT NULL DEFAULT FALSE,
				created_at       TIMESTAMPTZ DEFAULT NOW(),
				updated_at       TIMESTAMPTZ DEFAULT NOW()
			)
		`);
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
	} catch {
		// Postgres not available — silently skip
	}
}

function generateToken(): string {
	return crypto.randomBytes(18).toString('base64url');
}

interface SharedReportRow {
	token: string;
	notebook_id: string;
	notebook_name: string;
	snapshot: ShareSnapshot;
	poll_interval_ms: number | null;
	revoked: boolean;
	created_at: string;
	updated_at: string;
}

function rowToRecord(row: SharedReportRow): ShareRecord {
	return {
		token: row.token,
		notebookId: row.notebook_id,
		notebookName: row.notebook_name,
		snapshot: row.snapshot,
		pollIntervalMs: row.poll_interval_ms,
		revoked: row.revoked,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function getShareByToken(token: string): Promise<ShareRecord | null> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(`SELECT * FROM shared_reports WHERE token = $1`, [token]).catch(() => []);
	return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function getShareByNotebookId(notebookId: string): Promise<ShareRecord | null> {
	await ensureSharedReportTables();
	const rows = await query<SharedReportRow>(`SELECT * FROM shared_reports WHERE notebook_id = $1`, [notebookId]).catch(
		() => []
	);
	return rows[0] ? rowToRecord(rows[0]) : null;
}

export async function getShareConnections(token: string): Promise<ShareConnectionRecord[]> {
	await ensureSharedReportTables();
	const rows = await query<{ connection_id: string; connection: Connection; secret: ConnectionSecret | null }>(
		`SELECT connection_id, connection, secret FROM shared_report_connections WHERE token = $1`,
		[token]
	).catch(() => []);
	return rows.map((r) => ({ connectionId: r.connection_id, connection: r.connection, secret: r.secret }));
}

/** Upserts a share by notebookId, preserving the existing token across re-publishes. */
export async function upsertShare(input: {
	notebookId: string;
	notebookName: string;
	snapshot: ShareSnapshot;
	pollIntervalMs?: number | null;
	connections: ShareConnectionRecord[];
}): Promise<ShareRecord> {
	await ensureSharedReportTables();

	const existing = await getShareByNotebookId(input.notebookId);
	const token = existing?.token ?? generateToken();

	await query(
		`INSERT INTO shared_reports (token, notebook_id, notebook_name, snapshot, poll_interval_ms, revoked, updated_at)
		 VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, NOW())
		 ON CONFLICT (notebook_id) DO UPDATE SET
		   notebook_name    = EXCLUDED.notebook_name,
		   snapshot         = EXCLUDED.snapshot,
		   poll_interval_ms = EXCLUDED.poll_interval_ms,
		   revoked          = FALSE,
		   updated_at       = NOW()`,
		[token, input.notebookId, input.notebookName, JSON.stringify(input.snapshot), input.pollIntervalMs ?? null]
	);

	await query(`DELETE FROM shared_report_connections WHERE token = $1`, [token]);
	for (const conn of input.connections) {
		await query(
			`INSERT INTO shared_report_connections (token, connection_id, connection, secret)
			 VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
			[token, conn.connectionId, JSON.stringify(conn.connection), conn.secret ? JSON.stringify(conn.secret) : null]
		);
	}

	const saved = await getShareByToken(token);
	if (!saved) throw new Error('Failed to save share');
	return saved;
}

export async function revokeShareByNotebookId(notebookId: string): Promise<void> {
	await ensureSharedReportTables();
	await query(`UPDATE shared_reports SET revoked = TRUE, updated_at = NOW() WHERE notebook_id = $1`, [notebookId]);
}

/**
 * Mints a fresh token for the notebook's current share, copying snapshot + connections.
 * The old token is fully removed (not kept around revoked) — notebook_id is unique, so
 * only one share can exist per notebook at a time. Visiting the old URL 404s because the
 * row is gone, same outcome as revoking it.
 */
export async function regenerateShareToken(notebookId: string): Promise<ShareRecord> {
	await ensureSharedReportTables();
	const existing = await getShareByNotebookId(notebookId);
	if (!existing) throw new Error('No share exists for this notebook');

	const connections = await getShareConnections(existing.token);
	const newToken = generateToken();

	// Deletes the old row and cascades shared_report_connections for it.
	await query(`DELETE FROM shared_reports WHERE token = $1`, [existing.token]);

	await query(
		`INSERT INTO shared_reports (token, notebook_id, notebook_name, snapshot, poll_interval_ms, revoked, updated_at)
		 VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, NOW())`,
		[newToken, notebookId, existing.notebookName, JSON.stringify(existing.snapshot), existing.pollIntervalMs]
	);

	for (const conn of connections) {
		await query(
			`INSERT INTO shared_report_connections (token, connection_id, connection, secret)
			 VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
			[newToken, conn.connectionId, JSON.stringify(conn.connection), conn.secret ? JSON.stringify(conn.secret) : null]
		);
	}

	const saved = await getShareByToken(newToken);
	if (!saved) throw new Error('Failed to regenerate share');
	return saved;
}
