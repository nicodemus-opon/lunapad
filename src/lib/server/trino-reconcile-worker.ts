import { reconcileTrinoCatalogs } from './connections.js';
import { query } from './db.js';
import { deploymentMode } from './tenancy.js';

let started = false;

async function reconcileAllOrganizations(): Promise<void> {
	const orgRows = await query<{ id: string }>(
		`SELECT id FROM organizations WHERE archived_at IS NULL ORDER BY created_at ASC`
	).catch(() => []);
	for (const row of orgRows) {
		const statuses = await reconcileTrinoCatalogs(row.id);
		const failed = statuses.filter((status) => status.status === 'failed');
		if (failed.length > 0) {
			console.warn(`[trino-reconcile] ${failed.length} catalog(s) failed for org ${row.id}`);
		}
	}
}

export function startTrinoCatalogReconciler(): void {
	if (started) return;
	started = true;
	if (process.env.TRINO_RECONCILE_ON_STARTUP === 'false') return;
	if (process.env.DEMO_MODE === '1') return;

	const intervalMs = Math.max(
		0,
		Number(process.env.TRINO_RECONCILE_INTERVAL_MS ?? (deploymentMode() === 'cloud' ? '300000' : '0'))
	);

	const run = () => {
		void reconcileAllOrganizations().catch((err) => {
			console.warn(
				'[trino-reconcile] failed:',
				err instanceof Error ? err.message : String(err)
			);
		});
	};

	setTimeout(run, 5_000);
	if (intervalMs > 0) setInterval(run, intervalMs).unref?.();
}
