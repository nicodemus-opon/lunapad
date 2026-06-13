import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query } from '$lib/server/db.js';

export const GET: RequestHandler = async () => {
	try {
		const rows = await query<{ outcome: string; count: string }>(
			`SELECT outcome, COUNT(*) as count
			 FROM workspace_patterns
			 WHERE recorded_at > NOW() - INTERVAL '30 days'
			 GROUP BY outcome
			 ORDER BY count DESC`
		);

		if (rows.length === 0) return json({ patterns: '' });

		const kept = Number(rows.find((r) => r.outcome === 'kept')?.count ?? 0);
		const modified = Number(rows.find((r) => r.outcome === 'modified')?.count ?? 0);
		const deleted = Number(rows.find((r) => r.outcome === 'deleted')?.count ?? 0);
		const total = kept + modified + deleted;
		if (total === 0) return json({ patterns: '' });

		const parts: string[] = [];
		if (kept > 0) parts.push(`${kept} kept as-is`);
		if (modified > 0) parts.push(`${modified} modified after generation`);
		if (deleted > 0) parts.push(`${deleted} deleted`);

		const editRate = total > 0 ? Math.round(((modified + deleted) / total) * 100) : 0;
		const hint =
			editRate > 60
				? ' Prefer simpler, focused queries — users often refine generated code.'
				: editRate < 20
					? ' Generated queries have been well-accepted; continue the same style.'
					: '';

		return json({ patterns: `Last 30d: ${parts.join(', ')}.${hint}` });
	} catch {
		return json({ patterns: '' });
	}
};
