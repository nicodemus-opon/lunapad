/**
 * Client-side wrappers for the /api/project/* and /api/dbt/* server routes.
 * All functions run in the browser; they communicate with the local SvelteKit
 * server which has Node.js fs access.
 */

import type { Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import type { DbtModel } from '$lib/server/dbt';
import type { ProjectInfo } from '$lib/server/project';

// ── Project routes ───────────────────────────────────────────────────────────

export async function openProject(folder: string): Promise<ProjectInfo> {
	const res = await fetch('/api/project/open', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	const body = await res.json() as { error?: string } & ProjectInfo;
	if (!res.ok) throw new Error(body.error ?? 'Failed to open project');
	return body;
}

export async function listProjectNotebooks(
	folder: string
): Promise<{ notebooks: Notebook[]; folders: NotebookFolder[] }> {
	const res = await fetch(`/api/project/list?folder=${encodeURIComponent(folder)}`);
	const body = await res.json() as { error?: string; notebooks?: Notebook[]; folders?: NotebookFolder[] };
	if (!res.ok) throw new Error(body.error ?? 'Failed to list notebooks');
	return { notebooks: body.notebooks ?? [], folders: body.folders ?? [] };
}

export async function writeProjectFile(
	folder: string,
	file: string,
	content: string,
	isDbtProject?: boolean
): Promise<void> {
	const res = await fetch('/api/project/write', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, file, content, isDbtProject })
	});
	if (!res.ok) {
		const body = await res.json() as { error?: string };
		throw new Error(body.error ?? 'Failed to write file');
	}
}

export async function deleteProjectFile(folder: string, file: string): Promise<void> {
	const res = await fetch('/api/project/delete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, file })
	});
	if (!res.ok) {
		const body = await res.json() as { error?: string };
		throw new Error(body.error ?? 'Failed to delete file');
	}
}

export async function renameProjectFile(
	folder: string,
	oldFile: string,
	newFile: string
): Promise<void> {
	const res = await fetch('/api/project/rename', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, oldFile, newFile })
	});
	if (!res.ok) {
		const body = await res.json() as { error?: string };
		throw new Error(body.error ?? 'Failed to rename file');
	}
}

export async function scaffoldProject(folder: string, name: string): Promise<void> {
	const res = await fetch('/api/project/scaffold', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, name })
	});
	if (!res.ok) {
		const body = await res.json() as { error?: string };
		throw new Error(body.error ?? 'Failed to scaffold project');
	}
}

export async function revealInFinder(targetPath: string): Promise<void> {
	await fetch('/api/project/reveal', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: targetPath })
	});
}

/**
 * Subscribe to file system change events for the project folder.
 * Returns an unsubscribe function.
 *
 * `onChange`        — called with the relative path of a changed `.prql` file.
 * `onManifestChange` — called when `target/manifest.json` or `target/run_results.json`
 *                      changes (i.e. after an external `dbt run/compile`).
 */
export function watchProjectFolder(
	folder: string,
	onChange: (filename: string) => void,
	onManifestChange?: () => void
): () => void {
	const ctrl = new AbortController();
	const url = `/api/project/watch?folder=${encodeURIComponent(folder)}`;

	(async () => {
		try {
			const res = await fetch(url, { signal: ctrl.signal });
			if (!res.body) return;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data:')) continue;
					try {
						const event = JSON.parse(line.slice(5).trim()) as {
							type: string;
							filename?: string;
						};
						if (event.type === 'manifest-changed') {
							onManifestChange?.();
						} else if (event.filename) {
							onChange(event.filename);
						}
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// connection closed or aborted — fine
		}
	})();

	return () => ctrl.abort();
}

export async function auditProject(
	folder: string
): Promise<{ stubsAdded: string[] }> {
	const res = await fetch('/api/project/audit', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	const body = await res.json() as { error?: string; stubsAdded?: string[] };
	if (!res.ok) throw new Error(body.error ?? 'Audit failed');
	return { stubsAdded: body.stubsAdded ?? [] };
}

export async function backfillSchemaFromManifest(folder: string): Promise<void> {
	await fetch('/api/dbt/backfill-schema', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
}

export async function updateProjectSchema(
	folder: string,
	modelPath: string,
	updates: {
		description?: string | null;
		columns?: { name: string; description?: string; tests?: string[] }[];
		config?: { materialized?: string; schema?: string | null; tags?: string[] };
	}
): Promise<void> {
	const res = await fetch('/api/project/schema', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, modelPath, updates })
	});
	if (!res.ok) {
		const body = await res.json() as { error?: string };
		throw new Error(body.error ?? 'Failed to update schema');
	}
}

// ── dbt routes ───────────────────────────────────────────────────────────────

export async function fetchDbtManifest(folder: string): Promise<DbtModel[]> {
	const res = await fetch(`/api/dbt/manifest?folder=${encodeURIComponent(folder)}`);
	const body = await res.json() as { error?: string; models?: DbtModel[] };
	if (!res.ok) throw new Error(body.error ?? 'Failed to load dbt manifest');
	return body.models ?? [];
}

export async function dbtRun(folder: string, select?: string): Promise<string> {
	const res = await fetch('/api/dbt/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, select })
	});
	const body = await res.json() as { error?: string; jobId?: string };
	if (!res.ok) throw new Error(body.error ?? 'Failed to run dbt');
	return body.jobId!;
}

export async function dbtCompile(folder: string): Promise<string> {
	const res = await fetch('/api/dbt/compile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	const body = await res.json() as { error?: string; jobId?: string };
	if (!res.ok) throw new Error(body.error ?? 'Failed to compile dbt');
	return body.jobId!;
}

export async function dbtTest(folder: string, select?: string): Promise<string> {
	const res = await fetch('/api/dbt/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, select })
	});
	const body = await res.json() as { error?: string; jobId?: string };
	if (!res.ok) throw new Error(body.error ?? 'Failed to test dbt');
	return body.jobId!;
}

/**
 * Subscribe to live log output for a dbt job.
 * Returns an unsubscribe function.
 */
export function watchDbtLogs(
	jobId: string,
	onLine: (text: string) => void,
	onDone: (exitCode: number) => void
): () => void {
	const ctrl = new AbortController();

	(async () => {
		try {
			const res = await fetch(`/api/dbt/logs?jobId=${encodeURIComponent(jobId)}`, {
				signal: ctrl.signal
			});
			if (!res.body) return;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data:')) continue;
					try {
						const event = JSON.parse(line.slice(5).trim()) as {
							type: string;
							text?: string;
							exitCode?: number;
						};
						if (event.type === 'line' && event.text) onLine(event.text);
						if (event.type === 'done') onDone(event.exitCode ?? 0);
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// aborted
		}
	})();

	return () => ctrl.abort();
}
