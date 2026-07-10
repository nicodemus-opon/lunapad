// Pure classification/state helpers for runDashboardLoop (ai-chat-client.ts).
//
// The dashboard loop drives the atomic notebook tools (create_notebook,
// apply_notebook_patch, run_query_nodes, validate_notebook) and decides when the
// composition is complete by reading the tool-result strings those handlers return.
// The string literals matched here are the exact return values in
// ai-chat-client.ts:executeToolCallWithResult / executeReadTool — keep them in sync
// (dashboard-loop-signals.test.ts pins the contract).

export type DashboardResultKind =
	| 'notebook-created'
	| 'notebook-patched'
	| 'blueprint-rejected'
	| 'legacy-blocked'
	| 'validation-ok'
	| 'validation-failed'
	| 'inspection'
	| 'other';

const NOTEBOOK_CREATED_RE = /^Notebook '(.+?)' created \(id: /;
const NOTEBOOK_PATCHED_RE = /^Notebook '(.+?)' patched and validated/;
const BLUEPRINT_REJECTED_RE =
	/^(create_notebook: (draft validation failed|failed to create)|apply_notebook_patch: (notebook not found|blueprint validation failed|patch validation failed|document validation failed|provide blueprint))/;
// streamOneTurn wraps server-side policy rejections as 'create_cell/update_cell blocked: …';
// the bare 'Legacy cell tools are disabled' form covers a fallback that arrives unwrapped.
const LEGACY_BLOCKED_RE = /^(create_cell\/update_cell blocked:|Legacy cell tools are disabled)/;

export function classifyDashboardToolResult(result: string): DashboardResultKind {
	if (NOTEBOOK_CREATED_RE.test(result)) return 'notebook-created';
	if (NOTEBOOK_PATCHED_RE.test(result)) return 'notebook-patched';
	if (BLUEPRINT_REJECTED_RE.test(result)) return 'blueprint-rejected';
	if (LEGACY_BLOCKED_RE.test(result)) return 'legacy-blocked';
	if (result.startsWith('get_cell_result(') || result.startsWith('run_cells result:'))
		return 'inspection';
	// validate_notebook (and inspect_notebook) return pretty-printed JSON; only
	// validate_notebook carries a boolean `ok`.
	if (result.startsWith('{')) {
		try {
			const parsed = JSON.parse(result);
			if (typeof parsed?.ok === 'boolean') return parsed.ok ? 'validation-ok' : 'validation-failed';
		} catch {
			// not JSON — fall through
		}
	}
	return 'other';
}

export interface DashboardLoopState {
	/** The model looked at real data (get_cell_result / run_cells via run_query_nodes). */
	inspectedResult: boolean;
	/** A notebook was successfully created or patched this session. */
	notebookReady: boolean;
	/** The most recent validate_notebook reported ok:false and nothing repaired it since. */
	validationFailed: boolean;
	/** Consecutive turns whose only notebook-tool outcome was a blueprint rejection. */
	rejectedTurns: number;
	/** Consecutive turns in which the model called the disabled legacy cell tools. */
	legacyBlockedTurns: number;
	/** Last blueprint-rejection or legacy-block text, for the tail error message. */
	lastRejection: string | null;
	/** Title of the created/patched notebook, for messaging. */
	notebookLabel: string | null;
}

export function initialDashboardLoopState(): DashboardLoopState {
	return {
		inspectedResult: false,
		notebookReady: false,
		validationFailed: false,
		rejectedTurns: 0,
		legacyBlockedTurns: 0,
		lastRejection: null,
		notebookLabel: null
	};
}

export function reduceDashboardTurn(
	state: DashboardLoopState,
	toolResults: string[]
): DashboardLoopState {
	const next = { ...state };
	let progressed = false;
	let rejected = false;
	let legacyBlocked = false;

	for (const result of toolResults) {
		const kind = classifyDashboardToolResult(result);
		switch (kind) {
			case 'notebook-created':
			case 'notebook-patched': {
				progressed = true;
				next.notebookReady = true;
				next.validationFailed = false;
				const m =
					result.match(NOTEBOOK_CREATED_RE) ?? result.match(NOTEBOOK_PATCHED_RE);
				if (m) next.notebookLabel = m[1];
				break;
			}
			case 'blueprint-rejected':
				rejected = true;
				next.lastRejection = result;
				break;
			case 'legacy-blocked':
				legacyBlocked = true;
				next.lastRejection = result;
				break;
			case 'validation-ok':
				next.validationFailed = false;
				break;
			case 'validation-failed':
				next.validationFailed = true;
				break;
			case 'inspection':
				next.inspectedResult = true;
				break;
		}
	}

	// A turn that lands a create/patch resets both stall counters — rejections mixed
	// with progress are convergence, not thrash.
	next.rejectedTurns = progressed ? 0 : rejected ? state.rejectedTurns + 1 : state.rejectedTurns;
	next.legacyBlockedTurns = progressed
		? 0
		: legacyBlocked
			? state.legacyBlockedTurns + 1
			: state.legacyBlockedTurns;
	return next;
}

// create_notebook / apply_notebook_patch validate the document before writing, so a
// ready notebook is structurally valid by construction; an explicit validate_notebook
// ok:true is not additionally required — but a later ok:false blocks completion until
// repaired.
export function dashboardDone(state: DashboardLoopState, signalledDone: boolean): boolean {
	return (
		signalledDone && state.notebookReady && state.inspectedResult && !state.validationFailed
	);
}
