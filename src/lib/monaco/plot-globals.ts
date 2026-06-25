import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { javascriptDefaults } from 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';

// Monaco's TS language service has exactly one shared extraLibs dict and one
// shared program for every JS model in the app (`javascriptDefaults` is a
// single module-level singleton, confirmed in monaco.contribution.js — no
// per-model isolation). So per-cell sandbox globals (one upstream cell's
// outputName → {rows, columns} per plot cell) can't all be registered at once
// without leaking into every other JS editor. Instead we keep exactly one
// *active* set, swapped on editor focus — a deliberate simplification: a
// non-focused plot cell's editor briefly shows the previously-focused cell's
// globals until it's clicked into, which is an acceptable cost given the
// alternative (registering every cell's globals at once) causes real
// collisions when two plot cells' upstream sets differ.
const globalsByModel = new Map<string, string>();
let activeModelUri: string | null = null;

// Fixed virtual path — addExtraLib keys/versions its dict by filePath, so
// re-registering under the same path replaces the previous content instead
// of accumulating stale globals from earlier cells.
const ACTIVE_GLOBALS_PATH = 'file:///lunapad/plot-cell-globals.d.ts';

/** Record (or update) a model's sandbox-globals declaration text. If this
 *  model is currently the active one, the live extraLib is refreshed too. */
export function setModelPlotGlobals(model: Monaco.editor.ITextModel, dtsText: string): void {
	const uri = model.uri.toString();
	globalsByModel.set(uri, dtsText);
	if (uri === activeModelUri) applyActive(uri);
}

export function clearModelPlotGlobals(model: Monaco.editor.ITextModel): void {
	const uri = model.uri.toString();
	globalsByModel.delete(uri);
	if (activeModelUri === uri) activeModelUri = null;
}

/** Make this model's globals the live extraLib — call on editor focus. */
export function activatePlotGlobals(modelUri: string): void {
	activeModelUri = modelUri;
	applyActive(modelUri);
}

function applyActive(modelUri: string): void {
	javascriptDefaults.addExtraLib(globalsByModel.get(modelUri) ?? '', ACTIVE_GLOBALS_PATH);
}
