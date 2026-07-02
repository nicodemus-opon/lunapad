import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(currentDir, rel), 'utf8');

describe('NotebookCell anatomy', () => {
	const source = read('./NotebookCell.svelte');

	it('keeps the load-bearing focus/keyboard selectors', () => {
		// focusAdjacentCell and the page auto-focus query for this exact selector (cell-bridge)
		const bridge = read('../keyboard/cell-bridge.svelte.ts');
		expect(bridge).toContain("querySelectorAll<HTMLElement>('.notebook-cell[tabindex]')");
		expect(source).toContain('class="notebook-cell group');
		expect(source).toContain('tabindex="0"');
	});

	it('lays out as gutter + content grid, flat cell (no bordered card)', () => {
		expect(source).toContain('grid-cols-[var(--cell-gutter)_minmax(0,1fr)]');
		expect(source).not.toContain('border bg-accent/20');
		expect(source).not.toContain('shadow-[0_0_0_1px_hsl(var(--primary))]');
	});

	it('delegates chrome to the cell child components', () => {
		for (const component of [
			'CellGutter',
			'CellHeader',
			'CellMenu',
			'CellStatusLine',
			'CellSqlPreview',
			'CellModeSwitchDialogs'
		]) {
			expect(source).toContain(`<${component}`);
		}
		// the hand-rolled fixed-position kebab dropdown is gone
		expect(source).not.toContain('z-index: 200');
		expect(source).not.toContain('MoreVertical');
	});

	it('uses the three-state display model', () => {
		expect(source).toContain("effectiveDisplay === 'collapsed'");
		expect(source).toContain("effectiveDisplay !== 'full'");
		// report view forces output without mutating per-cell state (unless collapsed)
		expect(source).toContain('reportView && isQueryCell && cell.display');
		// collapsed cells do not render results
		expect(source).toContain('!cell.hideResult && cell.result');
	});

	it('renders markdown read-only in report view and supports visual dashboard editor', () => {
		expect(source).toContain('isMarkdownOutputOnly');
		expect(source).toContain('VisualDashboardEditor');
		expect(source).toContain('setMarkdownEditMode');
		expect(source).toContain('MARKDOWN_INTERACTIVE_SELECTOR');
		expect(source).toContain('handleMarkdownPreviewClick');
		expect(source).toContain('markdown-editor-stack');
	});

	it('shows execution time only on the status line, not inside the result toolbar', () => {
		expect(source).not.toContain('executionMs={cell.executionMs}');
	});

	it('states the row count once — no duplicate preview line under the result', () => {
		expect(source).not.toContain('Showing preview');
		// the open-full affordance lives on the status line instead
		expect(source).toContain('onOpenFull=');
	});

	it('supports worksheet view layout', () => {
		expect(source).toContain('worksheet?: boolean');
		expect(source).toContain('data-worksheet={worksheet ? true : undefined}');
		expect(source).toContain('fillHeight={worksheet}');
		expect(source).toContain('layout={editorLayout}');
		expect(source).toContain('onOpenWorksheet');
	});
});

describe('CellStatusLine', () => {
	const source = read('./cell/CellStatusLine.svelte');

	it('consolidates secondary metadata into chips with popovers', () => {
		expect(source).toContain('CellStatusChip');
		// raw cron expression lives inside the popover, not on the line
		expect(source).toContain('intervalMinutesToCronExpression');
		expect(source).toContain('Materialize now');
		expect(source).toContain('Re-run');
	});
});

describe('CellHeader', () => {
	const source = read('./cell/CellHeader.svelte');

	it('surfaces errors on collapsed cells', () => {
		expect(source).toContain('errorCount');
		expect(source).toContain('cell.materializeError');
	});

	it('expands a collapsed cell from the whole summary row', () => {
		expect(source).toContain("setCellDisplay(cell.id, 'full')");
		expect(source).toContain('onRowClick');
	});

	it('exposes worksheet view entry point', () => {
		expect(source).toContain('Maximize2');
		expect(source).toContain('onOpenWorksheet');
	});

	it('exposes markdown visual/source mode toggle', () => {
		expect(source).toContain('onMarkdownModeChange');
		expect(source).toContain('isMarkdownCell');
		expect(source).toContain('Visual dashboard editor');
	});
});
