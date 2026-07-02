import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, WIDGET_SNIPPETS } from './markdown-format';

describe('visual dashboard slash commands', () => {
	it('includes advanced dashboard authoring snippets', () => {
		const byId = new Map(SLASH_COMMANDS.map((cmd) => [cmd.id, cmd]));
		expect(byId.get('summary-table')?.snippet).toBe(WIDGET_SNIPPETS.summaryTable);
		expect(byId.get('pivot-table')?.snippet).toBe(WIDGET_SNIPPETS.pivotTable);
		expect(byId.get('conditional')?.snippet).toContain('{% if gt(');
		expect(byId.get('mermaid-loop')?.snippet).toContain('{% group');
	});
});
