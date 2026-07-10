import type { AIChatToolName } from '$lib/types/ai-chat.js';

const authCache = new Map<string, boolean>();

/** Client-side permission gate before executing an AI tool. Cached per tool per session. */
export async function authorizeAITool(tool: AIChatToolName | string): Promise<boolean> {
	if (authCache.has(tool)) return authCache.get(tool)!;

	try {
		const res = await fetch('/api/ai/authorize-tool', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tool })
		});
		if (!res.ok) {
			authCache.set(tool, false);
			return false;
		}
		const data = (await res.json()) as { allowed: boolean };
		authCache.set(tool, data.allowed);
		return data.allowed;
	} catch {
		// Offline / no auth — allow read tools, block mutations conservatively.
		const readOnly = ![
			'create_notebook',
			'apply_notebook_patch',
			'run_query_nodes',
			'create_cell',
			'update_cell',
			'delete_cell',
			'run_cells',
			'move_cell',
			'set_chart',
			'pick_chart',
			'set_view_mode'
		].includes(tool);
		authCache.set(tool, readOnly);
		return readOnly;
	}
}

export function clearAIToolAuthCache(): void {
	authCache.clear();
}
