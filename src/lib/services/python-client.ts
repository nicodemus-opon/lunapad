export interface PythonTablePayload {
	rows: Record<string, unknown>[];
	columns: string[];
}

export interface PythonTableDescriptor {
	dataKey: string;
	canonicalName: string;
	source: 'cell' | 'local' | 'external';
	aliases: string[];
	attributeAlias?: string | null;
	bindBareGlobal?: string | null;
	columns: string[];
	columnTypes?: string[];
	description?: string;
	rowMode: 'preview' | 'full';
}

export interface PythonRunResult {
	error: string | null;
	missingModule?: string | null;
	figures: string[];
	dataframe: { rows: Record<string, unknown>[]; columns: string[] } | null;
}

export async function runPython(
	notebookId: string,
	code: string,
	tables: Record<string, PythonTablePayload>,
	tableDescriptors: PythonTableDescriptor[],
	folder?: string | null
): Promise<string> {
	const res = await fetch('/api/python/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			notebookId,
			code,
			tables,
			tableDescriptors,
			folder: folder ?? undefined
		})
	});
	const body = (await res.json()) as { error?: string; jobId?: string; job?: { id?: string } };
	if (!res.ok) throw new Error(body.error ?? 'Failed to run python cell');
	const jobId = body.jobId ?? body.job?.id;
	if (!jobId) throw new Error('Python run did not return a job id');
	return jobId;
}

export interface PythonCompletionItem {
	name: string;
	type: string;
	detail: string;
	doc: string;
}

/** jedi-backed completion against a notebook's already-warm worker (so it
 * reflects real bound DataFrames/imports, not a static guess). Returns
 * empty if the notebook has no worker yet (i.e. no cell has run there) —
 * intentionally never triggers env provisioning from a completion request. */
export async function completePython(
	notebookId: string,
	code: string,
	line: number,
	column: number,
	tableDescriptors: PythonTableDescriptor[] = [],
	signal?: AbortSignal
): Promise<PythonCompletionItem[]> {
	try {
		const res = await fetch('/api/python/complete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notebookId, code, line, column, tableDescriptors }),
			signal
		});
		const body = (await res.json()) as { completions?: PythonCompletionItem[] };
		return body.completions ?? [];
	} catch {
		return [];
	}
}

export async function hoverPython(
	notebookId: string,
	code: string,
	line: number,
	column: number,
	tableDescriptors: PythonTableDescriptor[] = [],
	signal?: AbortSignal
): Promise<{ signature: string; doc: string } | null> {
	try {
		const res = await fetch('/api/python/hover', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notebookId, code, line, column, tableDescriptors }),
			signal
		});
		const body = (await res.json()) as { hover?: { signature: string; doc: string } | null };
		return body.hover ?? null;
	} catch {
		return null;
	}
}

export interface PythonPackage {
	name: string;
	version: string;
}

export async function listPythonPackages(): Promise<PythonPackage[]> {
	const res = await fetch('/api/python/packages');
	const body = (await res.json()) as { packages?: PythonPackage[] };
	return body.packages ?? [];
}

export async function installPythonPackage(
	name: string,
	folder?: string | null
): Promise<{ ok: boolean; message: string }> {
	const res = await fetch('/api/python/packages', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, folder: folder ?? undefined })
	});
	return (await res.json()) as { ok: boolean; message: string };
}

export async function uninstallPythonPackage(
	name: string,
	folder?: string | null
): Promise<{ ok: boolean; message: string }> {
	const res = await fetch('/api/python/packages', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, folder: folder ?? undefined })
	});
	return (await res.json()) as { ok: boolean; message: string };
}

/** Kills the notebook's warm Python worker and settles the job server-side —
 *  the SSE stream this job's `watchPythonLogs` is reading from will then
 *  receive a final `done` event with a "Cancelled" error result. */
export async function cancelPython(notebookId: string, jobId: string): Promise<void> {
	await fetch('/api/python/cancel', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ notebookId, jobId })
	});
}

/** Whether the server has already resolved a Python interpreter this process
 *  lifetime — lets the UI show a "setting up…" message only on a true first
 *  run, not every cell execution. */
export async function isPythonEnvReady(): Promise<boolean> {
	try {
		const res = await fetch('/api/python/ready');
		const body = (await res.json()) as { ready?: boolean };
		return body.ready ?? false;
	} catch {
		return false;
	}
}

export async function isPythonWorkerWarm(notebookId: string): Promise<boolean> {
	try {
		const res = await fetch(`/api/python/warm?notebookId=${encodeURIComponent(notebookId)}`);
		const body = (await res.json()) as { warm?: boolean };
		return body.warm ?? false;
	} catch {
		return false;
	}
}

/**
 * Subscribe to live stdout for a Python cell job, same SSE-over-fetch pattern
 * as project-client.ts's watchDbtLogs. Returns an unsubscribe function.
 */
export function watchPythonLogs(
	jobId: string,
	onLine: (text: string) => void,
	onDone: (exitCode: number, result: PythonRunResult | null) => void
): () => void {
	const ctrl = new AbortController();
	let unsubscribed = false;
	let sawDone = false;

	function dispatchDone(exitCode: number, result: PythonRunResult | null): void {
		if (sawDone) return;
		sawDone = true;
		onDone(exitCode, result);
	}

	(async () => {
		try {
			const res = await fetch(`/api/python/logs?jobId=${encodeURIComponent(jobId)}`, {
				signal: ctrl.signal
			});
			if (!res.ok || !res.body) {
				dispatchDone(-1, {
					error: `Failed to subscribe to python logs (HTTP ${res.status})`,
					figures: [],
					dataframe: null
				});
				return;
			}
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
							result?: PythonRunResult;
						};
						if (event.type === 'line' && event.text) onLine(event.text);
						if (event.type === 'done') dispatchDone(event.exitCode ?? 0, event.result ?? null);
					} catch {
						// ignore
					}
				}
			}

			// The connection closed (server-side or network drop) without ever
			// sending a "done" event — without this, the caller's promise would
			// hang in "running" state forever.
			if (!unsubscribed) {
				dispatchDone(-1, {
					error: 'Connection to the Python job closed before it finished.',
					figures: [],
					dataframe: null
				});
			}
		} catch {
			// fetch/reader threw — most likely our own abort() from unsubscribe,
			// but settle the promise regardless if that wasn't the case.
			if (!unsubscribed) {
				dispatchDone(-1, {
					error: 'Lost connection to the Python job.',
					figures: [],
					dataframe: null
				});
			}
		}
	})();

	return () => {
		unsubscribed = true;
		ctrl.abort();
	};
}
