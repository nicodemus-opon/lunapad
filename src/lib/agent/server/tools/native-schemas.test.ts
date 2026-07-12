import { describe, it, expect } from 'vitest';
import { NATIVE_TOOLS } from './native-schemas.js';

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
		expect(tool.function.description.toLowerCase()).toMatch(/not currently open|non-active|other notebook/);
		expect(tool.function.description.toLowerCase()).not.toMatch(/^atomically patch the current notebook/);
		const notebookIdProp = (
			tool.function.parameters as { properties: Record<string, { description?: string }> }
		).properties.notebookId;
		expect(notebookIdProp?.description).toBeTruthy();
	});

	it('inspect_notebook explains notebookId can target a non-active notebook', () => {
		const tool = toolByName('inspect_notebook');
		expect(tool.function.description.toLowerCase()).toMatch(/non-active|not currently open|other notebook/);
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
