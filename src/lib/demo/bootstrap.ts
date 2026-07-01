import { tick } from 'svelte';
import { DEMO_NOTEBOOK_NAME } from '$lib/demo/sales-analytics-demo';
import {
	deleteNotebook,
	getCells,
	getNotebooks,
	loadDemoNotebook,
	runCell,
	setActiveTab
} from '$lib/stores/notebook.svelte';

export const WORKSPACE_STORAGE_KEY = 'lunapad_notebook';
export const WELCOME_SEEN_KEY = 'lunapad_welcome_seen';

export function hasStoredWorkspace(): boolean {
	return (
		typeof localStorage !== 'undefined' && localStorage.getItem(WORKSPACE_STORAGE_KEY) !== null
	);
}

export function hasWelcomeBeenSeen(): boolean {
	return typeof localStorage !== 'undefined' && localStorage.getItem(WELCOME_SEEN_KEY) === '1';
}

export function markWelcomeSeen(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(WELCOME_SEEN_KEY, '1');
	}
}

export function shouldShowWelcome(demoMode: boolean, hadStoredWorkspace: boolean): boolean {
	if (demoMode) return false;
	if (hadStoredWorkspace) return false;
	return !hasWelcomeBeenSeen();
}

function findDemoNotebook() {
	return getNotebooks().find((nb) => nb.name === DEMO_NOTEBOOK_NAME) ?? null;
}

export async function bootstrapDemoNotebook(
	opts: {
		runCells?: boolean;
		replaceIfExists?: boolean;
	} = {}
): Promise<void> {
	const existing = findDemoNotebook();

	if (existing && opts.replaceIfExists) {
		deleteNotebook(existing.id);
	} else if (existing) {
		setActiveTab(existing.id);
	} else {
		loadDemoNotebook();
	}

	if (opts.runCells) {
		await tick();
		for (const cell of getCells()) {
			if (cell.cellType === 'query') await runCell(cell.id);
		}
	}
}

export function isDefaultEmptyNotebook(
	name: string | undefined,
	cells: { cellType: string; code: string; result: unknown }[]
): boolean {
	if (name !== 'Notebook 1' || cells.length !== 1) return false;
	const cell = cells[0];
	return cell.cellType === 'query' && !cell.result && !cell.code.trim();
}
