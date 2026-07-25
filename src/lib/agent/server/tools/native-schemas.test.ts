import { describe, it, expect } from 'vitest';
import { NATIVE_TOOLS, withoutUnavailablePythonCellType } from './native-schemas.js';

type CellTypeSchema = { enum?: string[] };

function cellTypeEnum(tool: (typeof NATIVE_TOOLS)[number], nested: boolean): string[] | undefined {
	const props = tool.function.parameters.properties as Record<string, any>;
	const executableCells = nested
		? props.blueprint.properties.executableCells
		: props.executableCells;
	const cellType = executableCells.items.properties.cellType as CellTypeSchema;
	return cellType.enum;
}

// Regression: create_notebook/apply_notebook_patch's cellType enum used to always include
// "python" even when the environment can't run Python cells, directly contradicting the
// system prompt's "Python cells are not available — always use SQL" guidance for that case.
describe('withoutUnavailablePythonCellType', () => {
	it('leaves tools unchanged when python is available', () => {
		const result = withoutUnavailablePythonCellType(NATIVE_TOOLS, true);
		expect(result).toBe(NATIVE_TOOLS);
	});

	it('strips "python" from create_notebook and apply_notebook_patch enums when unavailable', () => {
		const result = withoutUnavailablePythonCellType(NATIVE_TOOLS, false);
		const createNotebook = result.find((t) => t.function.name === 'create_notebook')!;
		const applyPatch = result.find((t) => t.function.name === 'apply_notebook_patch')!;
		expect(cellTypeEnum(createNotebook, true)).not.toContain('python');
		expect(cellTypeEnum(applyPatch, false)).not.toContain('python');
	});

	it('does not mutate the shared NATIVE_TOOLS export', () => {
		withoutUnavailablePythonCellType(NATIVE_TOOLS, false);
		const createNotebook = NATIVE_TOOLS.find((t) => t.function.name === 'create_notebook')!;
		expect(cellTypeEnum(createNotebook, true)).toContain('python');
	});

	it('leaves unrelated tools untouched', () => {
		const result = withoutUnavailablePythonCellType(NATIVE_TOOLS, false);
		const before = NATIVE_TOOLS.find((t) => t.function.name === 'run_query_nodes');
		const after = result.find((t) => t.function.name === 'run_query_nodes');
		expect(after).toBe(before);
	});
});

// Regression: apply_notebook_patch/inspect_notebook/validate_notebook all accept a
// notebookId param that can target a *background* (non-active) notebook, but their
// descriptions used to only talk about "the current notebook"/"the notebook they are
// already in" and left notebookId completely undocumented. A model reading only the
// tool schema (no notebookId description, and a description that actively says the tool
// is for the notebook you're "already in") has no way to learn it can — and should —
// pass notebookId to edit a notebook that isn't open, and falls back to create_notebook
// instead, producing a duplicate notebook rather than editing the intended one.
describe('notebook-targeting tool descriptions document notebookId', () => {
	function toolByName(name: string) {
		const tool = NATIVE_TOOLS.find((t) => t.function.name === name);
		if (!tool) throw new Error(`missing tool schema: ${name}`);
		return tool;
	}

	it('apply_notebook_patch explains notebookId can target a non-active notebook', () => {
		const tool = toolByName('apply_notebook_patch');
		expect(tool.function.description).toMatch(/notebookId/);
		expect(tool.function.description.toLowerCase()).toMatch(
			/not currently open|non-active|other notebook/
		);
		expect(tool.function.description.toLowerCase()).not.toMatch(
			/^atomically patch the current notebook/
		);
		const notebookIdProp = (
			tool.function.parameters as { properties: Record<string, { description?: string }> }
		).properties.notebookId;
		expect(notebookIdProp?.description).toBeTruthy();
	});

	it('inspect_notebook explains notebookId can target a non-active notebook', () => {
		const tool = toolByName('inspect_notebook');
		expect(tool.function.description.toLowerCase()).toMatch(
			/non-active|not currently open|other notebook/
		);
		const notebookIdProp = (
			tool.function.parameters as { properties: Record<string, { description?: string }> }
		).properties.notebookId;
		expect(notebookIdProp?.description).toBeTruthy();
	});

	it('validate_notebook documents notebookId', () => {
		const tool = toolByName('validate_notebook');
		const notebookIdProp = (
			tool.function.parameters as { properties: Record<string, { description?: string }> }
		).properties.notebookId;
		expect(notebookIdProp?.description).toBeTruthy();
	});
});
