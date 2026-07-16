import { loadWorkspaceState } from './workspace-store.js';
import {
	getShareByNotebookId,
	upsertShare,
	listDueRefreshSchedules,
	markRefreshScheduleRun
} from './shared-reports.js';
import { buildShareSnapshot } from '$lib/services/share-snapshot';
import type { Notebook } from '$lib/stores/notebook.svelte';
import type { Connection } from '$lib/types/connection';
import { getSecret } from './connection-secrets.js';
import { evaluateAlertRule, resolveMetricFromRows } from '$lib/services/share-alerts.js';
import { assertSafeOutboundHttpUrl } from './safe-outbound-url.js';

let workerStarted = false;

interface WorkspaceBlob {
	notebooks?: Notebook[];
	connections?: Connection[];
}

/** Optional alert rules stored on notebook (client workspace). */
function getNotebookAlertRules(notebook: Notebook) {
	const rules = (
		notebook as Notebook & {
			shareAlertRules?: Array<{
				metricPath: string;
				operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
				threshold: number;
				webhookUrl?: string;
			}>;
		}
	).shareAlertRules;
	return rules ?? [];
}

async function fireAlertWebhook(url: string, body: Record<string, unknown>): Promise<void> {
	try {
		const safeUrl = assertSafeOutboundHttpUrl(url);
		await fetch(safeUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch (err) {
		console.error('[share-alert]', err);
	}
}

function evaluateNotebookAlerts(
	notebook: Notebook,
	snapshot: ReturnType<typeof buildShareSnapshot>
): void {
	const rowsByOutput = new Map<string, Record<string, unknown>[]>();
	for (const cell of snapshot.cells) {
		if (cell.outputName && cell.frozenResult?.rows) {
			rowsByOutput.set(cell.outputName, cell.frozenResult.rows);
		}
	}
	for (const rule of getNotebookAlertRules(notebook)) {
		const actual = resolveMetricFromRows(rule.metricPath, rowsByOutput);
		if (!evaluateAlertRule(actual, rule.operator, rule.threshold)) continue;
		if (rule.webhookUrl) {
			void fireAlertWebhook(rule.webhookUrl, {
				notebookId: notebook.id,
				notebookName: notebook.name,
				metricPath: rule.metricPath,
				actual,
				threshold: rule.threshold,
				operator: rule.operator
			});
		}
	}
}

export async function runDueShareRefreshes(): Promise<number> {
	const due = await listDueRefreshSchedules();
	if (due.length === 0) return 0;

	let refreshed = 0;
	for (const schedule of due) {
		const tenant = { orgId: schedule.orgId, projectId: schedule.projectId };
		const workspace = await loadWorkspaceState(schedule.projectId);
		if (!workspace?.data) {
			await markRefreshScheduleRun(schedule.notebookId, tenant);
			continue;
		}
		const blob = workspace.data as WorkspaceBlob;
		const notebooks = blob.notebooks ?? [];
		const connections = blob.connections ?? [];
		const notebook = notebooks.find((n) => n.id === schedule.notebookId);
		const existing = await getShareByNotebookId(schedule.notebookId, tenant);
		if (!notebook || !existing || existing.revoked) {
			await markRefreshScheduleRun(schedule.notebookId, tenant);
			continue;
		}
		try {
			const snapshot = buildShareSnapshot(notebook, connections);
			const connInputs = await Promise.all(
				snapshot.connections.map(async (conn) => ({
					connectionId: conn.connectionId,
					connection: conn.connection,
					secret: await getSecret(conn.connectionId, schedule.orgId)
				}))
			);
			await upsertShare({
				tenant,
				notebookId: notebook.id,
				notebookName: notebook.name,
				snapshot: { cells: snapshot.cells, reportView: snapshot.reportView },
				pollIntervalMs: existing.pollIntervalMs,
				requireAuth: existing.requireAuth,
				slug: existing.slug,
				connections: connInputs
			});
			evaluateNotebookAlerts(notebook, snapshot);
			refreshed += 1;
		} catch (err) {
			console.error('[share-refresh]', schedule.notebookId, err);
		}
		await markRefreshScheduleRun(schedule.notebookId, tenant);
	}
	return refreshed;
}

export function startShareRefreshWorker(): void {
	if (workerStarted || typeof setInterval === 'undefined') return;
	workerStarted = true;
	const intervalMs = 60_000;
	setInterval(() => {
		void runDueShareRefreshes().catch((err) => console.error('[share-refresh]', err));
	}, intervalMs);
}
