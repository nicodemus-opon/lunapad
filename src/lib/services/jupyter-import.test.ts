import { describe, expect, it } from 'vitest';
import { parseJupyterNotebook } from './jupyter-import';

function ipynb(cells: unknown[], metadata: Record<string, unknown> = {}) {
	return JSON.stringify({
		nbformat: 4,
		nbformat_minor: 5,
		metadata: { kernelspec: { language: 'python' }, ...metadata },
		cells
	});
}

describe('parseJupyterNotebook', () => {
	it('converts markdown + code cells into a PM document and executable payloads', () => {
		const text = ipynb([
			{ cell_type: 'markdown', source: ['# Title\n', '\n', 'Some prose.'] },
			{ cell_type: 'code', source: "df = pd.read_csv('x.csv')\ndf" }
		]);
		const result = parseJupyterNotebook(text, 'analysis.ipynb', []);

		expect(result.name).toBe('analysis');
		expect(result.kernelLanguage).toBe('python');
		expect(result.executableCells).toHaveLength(1);
		expect(result.executableCells[0].cellType).toBe('python');
		expect(result.executableCells[0].code).toContain('read_csv');

		const queryBlocks = (result.document.content ?? []).filter((n) => n.type === 'queryBlock');
		expect(queryBlocks).toHaveLength(1);
		expect(queryBlocks[0].attrs?.cellId).toBe(result.executableCells[0].cellId);
	});

	it('dedupes output names against existing names and the file base name', () => {
		const text = ipynb([
			{ cell_type: 'code', source: 'print(1)' },
			{ cell_type: 'code', source: 'print(2)' }
		]);
		const result = parseJupyterNotebook(text, 'report.ipynb', ['report']);
		const names = result.executableCells.map((c) => c.outputName);
		expect(new Set(names).size).toBe(2);
		expect(names).not.toContain('report');
	});

	it('skips empty code cells', () => {
		const text = ipynb([
			{ cell_type: 'code', source: '' },
			{ cell_type: 'code', source: '   \n  ' }
		]);
		const result = parseJupyterNotebook(text, 'empty.ipynb', []);
		expect(result.executableCells).toHaveLength(0);
	});

	it('preserves raw cells as fenced code blocks instead of dropping them', () => {
		const text = ipynb([{ cell_type: 'raw', source: 'some raw latex content' }]);
		const result = parseJupyterNotebook(text, 'raw.ipynb', []);
		const md = JSON.stringify(result.document.content);
		expect(md).toContain('raw latex content');
	});

	it('reports non-python kernels without throwing', () => {
		const text = ipynb([{ cell_type: 'code', source: 'print("hi")' }], {
			kernelspec: { language: 'r' }
		});
		const result = parseJupyterNotebook(text, 'r-notebook.ipynb', []);
		expect(result.kernelLanguage).toBe('r');
		expect(result.executableCells).toHaveLength(1);
	});

	it('throws on invalid JSON', () => {
		expect(() => parseJupyterNotebook('not json', 'bad.ipynb', [])).toThrow();
	});

	it('throws when cells are missing', () => {
		expect(() => parseJupyterNotebook(JSON.stringify({ nbformat: 4 }), 'bad.ipynb', [])).toThrow();
	});

	it('supports nbformat 3 style worksheets', () => {
		const text = JSON.stringify({
			nbformat: 3,
			worksheets: [{ cells: [{ cell_type: 'code', source: 'x = 1' }] }]
		});
		const result = parseJupyterNotebook(text, 'legacy.ipynb', []);
		expect(result.executableCells).toHaveLength(1);
	});
});
