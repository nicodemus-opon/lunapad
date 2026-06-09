import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(currentDir, './NotebookCell.svelte');

describe('NotebookCell result controls', () => {
	it('shows result actions only when the cell is focused', () => {
		const source = readFileSync(sourcePath, 'utf8');

			expect(source).toContain('const showResultControls = $derived(cellFocused || cellHovered);');
		expect(source).toContain('{#snippet toolbarActions()}');
		expect(source).toContain('class="flex items-center gap-1 transition-opacity duration-150 ease-(--motion-ease-out)');
		expect(source).toContain("{showResultControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}");
			expect(source).toContain('controlsVisible={showResultControls}');
	});

	it('uses a single rounded notebook cell border for hover and focus highlights', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('class="notebook-cell group rounded-lg overflow-hidden border bg-accent/20 dark:bg-accent/30 text-foreground');
		expect(source).toContain("'border-border/70 hover:border-primary/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.45)]'");
	});

	it('does not render legacy sort/filter insight pills above result tabs', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).not.toContain('const resultInsights = $derived.by(() => {');
		expect(source).not.toContain('Sort ${sortableColumns[0]}');
		expect(source).not.toContain('Filter ${firstColumn}');
	});

	it('exposes explicit materialize and cron schedule UI controls', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('title="Materialize and schedule options"');
		expect(source).toContain('class="h-6 w-6 p-0"');
		expect(source).not.toContain('<span>Materialize</span>');
		// Cron/schedule controls live in MaterializeDialog (not inline)
		expect(source).toContain('MaterializeDialog');
		expect(source).toContain('materializeDialogOpen');
	});

	it('renders schedule and result metadata strip at the bottom of the card', () => {
		const source = readFileSync(sourcePath, 'utf8');

		expect(source).toContain('class="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-1"');
		expect(source).not.toContain('class="flex items-center gap-2 border-b border-border/40 px-3 py-1"');
		expect(source).not.toContain('class="flex items-center gap-1 ml-1 {statusColor}"');
		expect(source).toContain('materializing ({cell.materializeMode})');
		expect(source).toContain('schedule running');
	});

	it('lets header name input use remaining width', () => {
		const source = readFileSync(sourcePath, 'utf8');

		// Wrapper uses min-w-0 and flex-1 (dynamically when not collapsed)
		expect(source).toContain('class="min-w-0 {collapsed ?');
		expect(source).toContain("'flex-none' : 'flex-1'}");
		// Input uses full width and mono font
		expect(source).toContain('class="h-6 min-w-0 {collapsed ?');
		expect(source).toContain('text-xs font-mono bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/50 p-0"');
		expect(source).not.toContain('max-w-md');
	});
});
