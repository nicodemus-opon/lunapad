import { describe, expect, it } from 'vitest';
import { filterCommands } from './slash-command-extension';

describe('slash-command-extension filterCommands', () => {
	it('matches "hr" to divider via alias', () => {
		const results = filterCommands('hr');
		expect(results[0]?.id).toBe('divider');
	});

	it('matches "toggle" to details via alias', () => {
		const results = filterCommands('toggle');
		expect(results[0]?.id).toBe('details');
	});

	it('matches "h5" to heading 5', () => {
		const results = filterCommands('h5');
		expect(results[0]?.id).toBe('h5');
	});

	it('matches "todo" to task via alias', () => {
		const results = filterCommands('todo');
		expect(results[0]?.id).toBe('task');
	});

	it('matches "img" to image via alias', () => {
		const results = filterCommands('img');
		expect(results[0]?.id).toBe('image');
	});

	it('matches "info" to callout via alias', () => {
		const results = filterCommands('info');
		expect(results[0]?.id).toBe('callout');
	});

	it('matches "cols" to columns via alias', () => {
		const results = filterCommands('cols');
		expect(results[0]?.id).toBe('columns');
	});

	it('shows control cells in the visible slash menu with short labels', () => {
		expect(filterCommands('slider')[0]?.id).toBe('control-slider');
		expect(filterCommands('editable table')[0]?.id).toBe('control-table-input');
		expect(filterCommands('agent')[0]?.id).toBe('control-agent');
	});

	it('keeps notebook as a discoverability alias without forcing users to type it', () => {
		expect(filterCommands('notebook slider')[0]?.id).toBe('control-slider');
	});

	it('still matches by exact id over aliases', () => {
		const results = filterCommands('link');
		expect(results[0]?.id).toBe('link');
	});

	it('returns empty for gibberish query', () => {
		expect(filterCommands('zzzznonexistent')).toEqual([]);
	});
});
