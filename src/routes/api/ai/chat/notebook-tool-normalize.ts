import { parseToolCallObject } from '$lib/services/tool-call-parse.js';
import { repairNotebookBlueprint } from '$lib/services/notebook-app-planner.js';
import type { NotebookBlueprint } from '$lib/services/notebook-blueprint.js';

function parseJsonishToolValue(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed || !/^[{[]/.test(trimmed)) return value;
	const parsed = parseToolCallObject(trimmed);
	if (parsed) return parsed;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

export function normalizeNotebookToolArgs(
	tool: string,
	args: Record<string, unknown>
): Record<string, unknown> {
	const next = { ...args };
	if ('blueprint' in next) next.blueprint = parseJsonishToolValue(next.blueprint);
	if (next.blueprint && typeof next.blueprint === 'object' && !Array.isArray(next.blueprint)) {
		const blueprint = { ...(next.blueprint as Record<string, unknown>) };
		for (const key of ['blocks', 'executableCells']) {
			if (key in blueprint) blueprint[key] = parseJsonishToolValue(blueprint[key]);
		}
		next.blueprint = blueprint;
	}
	for (const key of ['blocks', 'executableCells', 'operations', 'document']) {
		if (key in next) next[key] = parseJsonishToolValue(next[key]);
	}
	if ((tool === 'create_notebook' || tool === 'apply_notebook_patch') && next.blueprint) {
		const repaired = repairNotebookBlueprint(next.blueprint as NotebookBlueprint, {
			autoRepair:
				(next.blueprint as { autoRepair?: 'off' | 'safe' | 'aggressive' }).autoRepair ?? 'safe'
		});
		next.blueprint = repaired.blueprint;
	}
	if (tool === 'create_notebook' && !next.blueprint && Array.isArray(next.blocks)) {
		const repaired = repairNotebookBlueprint(next as unknown as NotebookBlueprint, {
			autoRepair: (next as { autoRepair?: 'off' | 'safe' | 'aggressive' }).autoRepair ?? 'safe'
		});
		Object.assign(next, repaired.blueprint);
	}
	return next;
}
