import { describe, expect, it } from 'vitest';
import { formattingKitchenSinkTemplate } from '$lib/demo/templates/formatting-kitchen-sink';
import type { Cell } from '$lib/stores/notebook.svelte';
import {
	attachNotebookBlockIds,
	cellsToPmDocument,
	pmDocumentToBlocks,
	extractPagesFromPmDocument
} from './notebook-pm';
import type { PMNodeJSON } from './markdoc-pm';
import { defaultControlCellConfig } from './control-cells';

function collectNodeTypes(node: PMNodeJSON | { type: 'doc'; content?: PMNodeJSON[] }): string[] {
	const types = [node.type];
	for (const child of node.content ?? []) types.push(...collectNodeTypes(child));
	return types;
}

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

function makeControlCell(id: string): Cell {
	const controlConfig = defaultControlCellConfig('slider', 'slider');
	return {
		id,
		cellType: 'input',
		markdown: '',
		outputName: 'slider',
		code: '',
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'prql',
		language: 'sql',
		status: 'idle',
		errors: [],
		display: 'output',
		hideResult: false,
		controlConfig,
		result: { rows: [{ name: 'slider', value: 50 }], columns: ['name', 'value'] }
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

	it('keeps plain H1 headings in markdown during document sync', () => {
		const cells = [
			makeMarkdownCell('md1', '# Sales Analytics Demo\n\nIntro prose.'),
			makeQueryCell('q1')
		];
		const blocks = pmDocumentToBlocks(cellsToPmDocument(cells));

		expect(blocks.some((b) => b.kind === 'page')).toBe(false);
		expect(blocks[0]).toMatchObject({
			kind: 'markdown',
			markdown: expect.stringContaining('# Sales Analytics Demo')
		});
		expect(blocks.some((b) => b.kind === 'query' && b.cellId === 'q1')).toBe(true);
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

	it('renders control cells as document atoms with cellType preserved', () => {
		const cells = [makeMarkdownCell('md1', 'Intro'), makeControlCell('slider1')];
		const doc = cellsToPmDocument(cells);
		const qb = (doc.content ?? []).find((n) => n.type === 'queryBlock');
		expect(qb?.attrs?.cellId).toBe('slider1');
		expect(qb?.attrs?.cellType).toBe('input');
		const blocks = pmDocumentToBlocks(doc);
		expect(blocks).toEqual(
			expect.arrayContaining([
				{ kind: 'query', cellId: 'slider1', cellType: 'input' },
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

	it('keeps the formatting kitchen sink TipTap-compatible for notebook document mode', () => {
		const notebook = formattingKitchenSinkTemplate.build();
		const doc = cellsToPmDocument(notebook.cells);
		const types = collectNodeTypes(doc);

		expect(types).not.toContain('list_item');
		expect(types).not.toContain('bullet_list');
		expect(types).not.toContain('ordered_list');
		expect(types).not.toContain('code_block');
		expect(types).toContain('listItem');
		expect(types).toContain('bulletList');
		expect(types).toContain('taskList');
	});

	it('serializes TipTap list nodes from notebook document mode back to markdown', () => {
		const doc: import('./markdoc-pm').PMDocJSON = {
			type: 'doc',
			content: [
				{
					type: 'bulletList',
					content: [
						{
							type: 'listItem',
							content: [
								{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
								{
									type: 'bulletList',
									content: [
										{
											type: 'listItem',
											content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }]
										}
									]
								}
							]
						},
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }]
						}
					]
				},
				{
					type: 'orderedList',
					attrs: { start: 3 },
					content: [
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }]
						}
					]
				}
			]
		};

		const blocks = pmDocumentToBlocks(doc);
		const markdown = blocks.find((block) => block.kind === 'markdown')?.markdown ?? '';

		expect(markdown).toContain('* one');
		expect(markdown).toContain('  * nested');
		expect(markdown).toContain('* two');
		expect(markdown).toContain('3. three');
	});

	it('reattaches markdown ids around query blocks so sync does not churn cells', () => {
		const cells = [
			makeMarkdownCell('md-before', '{% tabs %}\n{% tab label="A" %}\nHi\n{% /tab %}\n{% /tabs %}'),
			makeQueryCell('q1'),
			makeMarkdownCell('md-after', '{% callout type="info" %}\nAfter\n{% /callout %}')
		];
		const doc = cellsToPmDocument(cells);
		const attached = attachNotebookBlockIds(cells, pmDocumentToBlocks(doc));
		expect(attached).toEqual([
			expect.objectContaining({ kind: 'markdown', cellId: 'md-before' }),
			{ kind: 'query', cellId: 'q1', cellType: 'query' },
			expect.objectContaining({ kind: 'markdown', cellId: 'md-after' })
		]);
	});

	it('keeps markdown/query/markdown regions stable across repeated round-trips', () => {
		const cells = [
			makeMarkdownCell(
				'md-before',
				'{% tabs %}\n{% tab label="Metrics" %}\n{% columns %}\n{% column %}\nLeft\n{% /column %}\n{% column %}\nRight\n{% /column %}\n{% /columns %}\n{% /tab %}\n{% /tabs %}'
			),
			makeQueryCell('q1'),
			makeMarkdownCell(
				'md-after',
				'{% grid cols=2 %}\n{% card title="A" %}\nOne\n{% /card %}\n{% card title="B" %}\nTwo\n{% /card %}\n{% /grid %}'
			)
		];
		let blocks = attachNotebookBlockIds(cells, pmDocumentToBlocks(cellsToPmDocument(cells)));
		for (let i = 0; i < 3; i++) {
			const doc = cellsToPmDocument(
				blocks.flatMap((block) => {
					if (block.kind === 'query') return [makeQueryCell(block.cellId)];
					if (block.kind === 'markdown') {
						return [makeMarkdownCell(block.cellId ?? `md-${i}`, block.markdown)];
					}
					return [];
				})
			);
			blocks = attachNotebookBlockIds(cells, pmDocumentToBlocks(doc));
		}
		expect(blocks[0]).toMatchObject({ kind: 'markdown', cellId: 'md-before' });
		expect(blocks[1]).toEqual({ kind: 'query', cellId: 'q1', cellType: 'query' });
		expect(blocks[2]).toMatchObject({ kind: 'markdown', cellId: 'md-after' });
	});

	it('does not guess markdown ids when a region has multiple markdown cells', () => {
		const cells = [
			makeMarkdownCell('md-a', 'Alpha'),
			makeMarkdownCell('md-b', 'Beta'),
			makeQueryCell('q1')
		];
		const blocks = attachNotebookBlockIds(cells, pmDocumentToBlocks(cellsToPmDocument(cells)));
		expect(blocks[0]).toMatchObject({ kind: 'markdown' });
		if (blocks[0]?.kind === 'markdown') {
			expect(blocks[0].cellId).toBeUndefined();
		}
	});
});
