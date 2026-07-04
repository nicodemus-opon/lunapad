import { describe, expect, it } from 'vitest';
import type { Cell } from '$lib/stores/notebook.svelte';
import {
	cellsToPmDocument,
	pmDocumentToBlocks,
	extractPagesFromPmDocument
} from './notebook-pm';

function makeMarkdownCell(id: string, markdown: string): Cell {
	return {
		id,
		cellType: 'markdown',
		markdown,
		outputName: '',
		code: '',
		guiStages: [],
		editMode: 'prql',
		language: 'sql',
		status: 'idle',
		errors: [],
		display: 'full',
		hideResult: false
	} as unknown as Cell;
}

function makeQueryCell(id: string, code = 'from x'): Cell {
	return {
		id,
		cellType: 'query',
		markdown: '',
		outputName: id,
		code,
		guiStages: [{ type: 'from', table: 'x' }],
		editMode: 'prql',
		language: 'sql',
		status: 'idle',
		errors: [],
		display: 'output',
		hideResult: false
	} as unknown as Cell;
}

function makePythonCell(id: string, code = 'print("ok")'): Cell {
	return {
		id,
		cellType: 'python',
		markdown: '',
		outputName: id,
		code,
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'prql',
		language: 'prql',
		status: 'idle',
		errors: [],
		display: 'output',
		hideResult: false,
		pythonOutput: null
	} as unknown as Cell;
}

describe('notebook-pm', () => {
	it('maps markdown + query cells to a single PM document', () => {
		const cells = [
			makeMarkdownCell('md1', '# Intro\n\nSome prose.'),
			makeQueryCell('q1'),
			makeMarkdownCell('md2', 'More text.')
		];
		const doc = cellsToPmDocument(cells);
		const types = (doc.content ?? []).map((n) => n.type);
		expect(types).toContain('heading');
		expect(types).toContain('queryBlock');
		expect(types.filter((t) => t === 'queryBlock')).toHaveLength(1);
	});

	it('round-trips blocks preserving query cell ids', () => {
		const cells = [makeMarkdownCell('md1', 'Hello'), makeQueryCell('q1')];
		const doc = cellsToPmDocument(cells);
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks.some((b) => b.kind === 'query' && b.cellId === 'q1')).toBe(true);
		expect(blocks.some((b) => b.kind === 'markdown' && b.markdown.includes('Hello'))).toBe(true);
	});

	it('round-trips python cells with cellType preserved', () => {
		const cells = [makeMarkdownCell('md1', 'Intro'), makePythonCell('py1', 'orders.head()')];
		const doc = cellsToPmDocument(cells);
		const qb = (doc.content ?? []).find((n) => n.type === 'queryBlock');
		expect(qb?.attrs?.cellId).toBe('py1');
		expect(qb?.attrs?.cellType).toBe('python');
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks).toEqual(
			expect.arrayContaining([
				{ kind: 'query', cellId: 'py1', cellType: 'python' },
				expect.objectContaining({ kind: 'markdown', markdown: expect.stringContaining('Intro') })
			])
		);
	});

	it('extracts H1 pages from the document', () => {
		const cells = [makeMarkdownCell('md1', '# Page One\n\nBody'), makeQueryCell('q1')];
		const doc = cellsToPmDocument(cells);
		const pages = extractPagesFromPmDocument(doc);
		expect(pages.length).toBeGreaterThanOrEqual(1);
		expect(pages[0]?.title).toBe('Page One');
	});

	it('appends a trailing paragraph after a document ending in a query block', () => {
		const doc = cellsToPmDocument([makeQueryCell('q1')]);
		const content = doc.content ?? [];
		expect(content[content.length - 1]?.type).toBe('paragraph');
	});

	it('prepends a leading paragraph before a document starting with a query block', () => {
		const doc = cellsToPmDocument([makeQueryCell('q1')]);
		const content = doc.content ?? [];
		expect(content[0]?.type).toBe('paragraph');
		expect(content.some((n) => n.type === 'queryBlock')).toBe(true);
	});

	it('does not persist the leading affordance paragraph as a cell', () => {
		const doc = cellsToPmDocument([makeQueryCell('q1')]);
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe('query');
	});

	it('does not persist the trailing affordance paragraph as a cell', () => {
		const doc = cellsToPmDocument([makeQueryCell('q1')]);
		const blocks = pmDocumentToBlocks(doc);
		// Only the query survives — the auto-added trailing empty line is stripped.
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe('query');
	});

	it('keeps interior prose while stripping boundary empty lines', () => {
		const doc: import('./markdoc-pm').PMDocJSON = {
			type: 'doc',
			content: [
				{ type: 'paragraph' },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Middle' }] },
				{ type: 'paragraph' }
			]
		};
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind === 'markdown' && blocks[0].markdown.includes('Middle')).toBe(true);
	});

	it('persists notebookPage nodes as H1 markdown blocks', () => {
		const doc: import('./markdoc-pm').PMDocJSON = {
			type: 'doc',
			content: [
				{
					type: 'notebookPage',
					attrs: { title: 'Nested Page', pageId: 'p1' }
				},
				{ type: 'paragraph', content: [{ type: 'text', text: 'After page' }] }
			]
		};

		const blocks = pmDocumentToBlocks(doc);
		expect(blocks.some((b) => b.kind === 'page' && b.title === 'Nested Page')).toBe(true);
		const md = blocks.find((b) => b.kind === 'markdown');
		expect(md?.markdown).toContain('Nested Page');
		expect(md?.markdown).toContain('After page');
	});

	it('does not persist a lone slash from a dismissed slash menu as a cell', () => {
		const doc: import('./markdoc-pm').PMDocJSON = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: '/' }] },
				{ type: 'queryBlock', attrs: { cellId: 'q1', cellType: 'query' } },
				{ type: 'paragraph' }
			]
		};
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe('query');
	});

	it('does not persist trailing slash affordance inside a narrative run', () => {
		const doc: import('./markdoc-pm').PMDocJSON = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Hello world.' }]
				},
				{ type: 'paragraph', content: [{ type: 'text', text: '/' }] },
				{ type: 'queryBlock', attrs: { cellId: 'q1', cellType: 'query' } },
				{ type: 'paragraph' }
			]
		};
		const blocks = pmDocumentToBlocks(doc);
		const md = blocks.find((b) => b.kind === 'markdown');
		expect(md?.markdown).toBe('Hello world.');
		expect(md?.markdown).not.toContain('/');
	});

	it('round-trips GFM tables through cellsToPmDocument → pmDocumentToBlocks', () => {
		const md = 'Intro\n\n| Name | Age |\n| --- | --- |\n\n| Bob | 30 |';
		const cells = [makeMarkdownCell('m1', md)];
		const doc = cellsToPmDocument(cells);
		expect((doc.content ?? []).some((n) => n.type === 'table')).toBe(true);
		const blocks = pmDocumentToBlocks(doc);
		const out = blocks.find((b) => b.kind === 'markdown')?.markdown ?? '';
		expect(out).toContain('| Bob | 30 |');
	});
});
