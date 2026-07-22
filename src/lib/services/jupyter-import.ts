import { markdownToPmDocument, type PMDocJSON, type PMNodeJSON } from './markdoc-pm';
import { sanitizeTableName } from './duckdb';

export interface JupyterExecutableCellPayload {
	cellId: string;
	outputName: string;
	cellType: 'python';
	code: string;
}

export interface JupyterImportResult {
	name: string;
	document: PMDocJSON;
	executableCells: JupyterExecutableCellPayload[];
	kernelLanguage: string | null;
}

interface RawJupyterCell {
	cell_type?: string;
	source?: string | string[];
}

interface RawJupyterNotebook {
	cells?: RawJupyterCell[];
	// nbformat 3 nested its cells under `worksheets` instead of a top-level `cells` array.
	worksheets?: { cells?: RawJupyterCell[] }[];
	metadata?: {
		kernelspec?: { language?: string };
		language_info?: { name?: string };
	};
}

function joinSource(source: string | string[] | undefined): string {
	return Array.isArray(source) ? source.join('') : (source ?? '');
}

function makeCellId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Parse a .ipynb file's contents into a PM document + executable-cell payloads
 * ready for `createNotebookFromPmDocument`. Markdown/raw cells become prose;
 * code cells become pinned Python query blocks (Lunapad has no other cellType
 * that runs arbitrary code, so non-Python kernels are imported best-effort —
 * callers should surface `kernelLanguage` to the user when it isn't Python).
 */
export function parseJupyterNotebook(
	text: string,
	fileName: string,
	existingOutputNames: Iterable<string>
): JupyterImportResult {
	let raw: RawJupyterNotebook;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new Error('Not a valid .ipynb file (invalid JSON)');
	}

	const cells = raw.cells ?? raw.worksheets?.flatMap((w) => w.cells ?? []);
	if (!Array.isArray(cells)) {
		throw new Error('Not a valid Jupyter notebook (missing cells)');
	}

	const kernelLanguage =
		raw.metadata?.kernelspec?.language ?? raw.metadata?.language_info?.name ?? null;

	const takenNames = new Set(existingOutputNames);
	const baseOutputName = sanitizeTableName(fileName) || 'imported_cell';
	function nextOutputName(): string {
		let name = baseOutputName;
		let counter = 1;
		while (takenNames.has(name)) name = `${baseOutputName}_${counter++}`;
		takenNames.add(name);
		return name;
	}

	const content: PMNodeJSON[] = [];
	const executableCells: JupyterExecutableCellPayload[] = [];

	for (const cell of cells) {
		const source = joinSource(cell.source);

		if (cell.cell_type === 'code') {
			if (!source.trim()) continue;
			const cellId = makeCellId();
			content.push({
				type: 'queryBlock',
				attrs: { cellId, cellType: 'python', pinned: true }
			});
			executableCells.push({
				cellId,
				outputName: nextOutputName(),
				cellType: 'python',
				code: source
			});
			continue;
		}

		// Markdown cells become prose directly; raw (and any other) cell types are
		// preserved as a fenced code block so their content isn't silently dropped.
		const md =
			cell.cell_type === 'markdown' ? source : source.trim() ? '```\n' + source + '\n```' : '';
		if (!md.trim()) continue;
		const pm = markdownToPmDocument(md);
		content.push(...(pm.doc.content ?? []));
	}

	if (!content.length) content.push({ type: 'paragraph' });

	return {
		name: fileName.replace(/\.ipynb$/i, '') || 'Imported notebook',
		document: { type: 'doc', content },
		executableCells,
		kernelLanguage
	};
}
