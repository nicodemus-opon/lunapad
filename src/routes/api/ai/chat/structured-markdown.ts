import type { AIChatCell } from '$lib/types/ai-chat.js';
import { compileGeneratedDashboard } from '$lib/services/generated-dashboard.js';

export function hasDashboardResultContextFromMessages(
	messages: Array<{ role: 'user' | 'assistant'; content: string }>
): boolean {
	return messages.some(
		(m) =>
			/get_cell_result\([^)]+\):/i.test(m.content) ||
			/run_cells result:/i.test(m.content)
	);
}

export function compileStructuredMarkdownArgs(
	tool: string,
	args: Record<string, unknown>,
	cells: AIChatCell[],
	knownOutputNames?: Iterable<string>
): { args: Record<string, unknown>; errors: string[] } {
	if ((tool !== 'create_cell' && tool !== 'update_cell') || !args.dashboard) {
		return { args, errors: [] };
	}

	if (typeof args.dashboard !== 'object' || Array.isArray(args.dashboard)) {
		return { args, errors: ['dashboard payload must be an object'] };
	}

	const knownCells = knownOutputNames
		? [...new Set(knownOutputNames)].map((outputName) => ({
				id: outputName,
				outputName,
				language: 'sql' as const,
				cellType: 'query' as const,
				code: '',
				resultColumns: [],
				status: 'success'
			}))
		: cells;

	const compiled = compileGeneratedDashboard(
		args.dashboard as Parameters<typeof compileGeneratedDashboard>[0],
		{
			knownCells
		}
	);
	if (compiled.errors.length > 0) {
		return { args, errors: compiled.errors };
	}

	return {
		args: {
			...args,
			cellType: 'markdown',
			markdown: compiled.markdown
		},
		errors: []
	};
}
