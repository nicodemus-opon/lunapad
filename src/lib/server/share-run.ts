import { getShareByToken, getShareConnections, type ShareRecord } from './shared-reports';
import { queryExternalConnection } from './connections';
import { substituteFilterTokens } from '$lib/services/filter-substitution';
import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
import { getCachedResult, setCachedResult, makeQueryCacheKey } from './result-cache';
import { isRateLimitedAsync } from './share-rate-limit';

export interface ShareRunResult {
	rows: Record<string, unknown>[];
	columns: string[];
}

export type ShareRunError = { error: string; status: number };

export async function runShareLiveCell(
	token: string,
	cellId: string,
	filters: Record<string, string> = {},
	opts?: { skipRateLimit?: boolean }
): Promise<ShareRunResult | ShareRunError> {
	if (!opts?.skipRateLimit && (await isRateLimitedAsync(token))) {
		return { error: 'Too many requests', status: 429 };
	}

	const share = await getShareByToken(token);
	if (!share || share.revoked) return { error: 'Not found', status: 410 };
	if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
		return { error: 'This report link has expired.', status: 410 };
	}

	const cell = share.snapshot.cells.find((c) => c.id === cellId);
	if (!cell || !cell.isLive || !cell.sqlTemplate) {
		return { error: 'Cell is not live.', status: 400 };
	}
	if (!cell.connectionId || cell.connectionId === BUILTIN_DUCKDB_CONNECTION_ID) {
		return { error: 'Cell is not live.', status: 400 };
	}

	const connections = await getShareConnections(token);
	const record = connections.find((c) => c.connectionId === cell.connectionId);
	if (!record) return { error: 'Connection not found for this share.', status: 400 };

	const sql = substituteFilterTokens(cell.sqlTemplate, filters);
	const ttlMs = share.pollIntervalMs ?? 300_000;
	const cacheKey = makeQueryCacheKey(token, cell.id, sql);

	const cached = await getCachedResult(cacheKey);
	if (cached && typeof cached === 'object' && cached !== null && 'rows' in cached) {
		return cached as ShareRunResult;
	}

	try {
		const result = await queryExternalConnection(
			record.connection,
			record.secret ?? undefined,
			sql
		);
		await setCachedResult(cacheKey, result, ttlMs);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to run query.';
		return { error: message, status: 400 };
	}
}

export async function prefetchLiveShareResults(
	share: ShareRecord,
	filters: Record<string, string> = {}
): Promise<Record<string, ShareRunResult | null>> {
	const out: Record<string, ShareRunResult | null> = {};
	const liveCells = share.snapshot.cells.filter((c) => c.isLive);
	await Promise.all(
		liveCells.map(async (cell) => {
			const result = await runShareLiveCell(share.token, cell.id, filters, {
				skipRateLimit: true
			});
			out[cell.id] = 'error' in result ? null : result;
		})
	);
	return out;
}

export function isShareExpired(share: ShareRecord): boolean {
	return Boolean(share.expiresAt && new Date(share.expiresAt) < new Date());
}
