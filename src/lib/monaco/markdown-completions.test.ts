import { describe, expect, it } from 'vitest';
import { detectMarkdownCompletionContext, getOpenMarkdocTags } from './markdown-completions';

describe('getOpenMarkdocTags', () => {
	it('tracks open block tags', () => {
		const md = '{% callout %}\n{% card title="x" %}\n';
		expect(getOpenMarkdocTags(md)).toEqual(['callout', 'card']);
	});

	it('pops on close tags', () => {
		const md = '{% callout %}\n{% /callout %}';
		expect(getOpenMarkdocTags(md)).toEqual([]);
	});

	it('ignores self-closing tags', () => {
		const md = '{% metric value=$x.count label="X" /%}';
		expect(getOpenMarkdocTags(md)).toEqual([]);
	});
});

describe('detectMarkdownCompletionContext', () => {
	it('detects slash commands', () => {
		const ctx = detectMarkdownCompletionContext('/met', '', 4);
		expect(ctx.kind).toBe('slash');
		if (ctx.kind === 'slash') expect(ctx.partial).toBe('met');
	});

	it('detects tag-open', () => {
		const ctx = detectMarkdownCompletionContext('{% char', '', 7);
		expect(ctx.kind).toBe('tag-open');
		if (ctx.kind === 'tag-open') expect(ctx.partial).toBe('char');
	});

	it('detects tag-close with open stack', () => {
		const full = '{% callout %}\n{% /cal';
		const ctx = detectMarkdownCompletionContext('{% /cal', full, 8);
		expect(ctx.kind).toBe('tag-close');
		if (ctx.kind === 'tag-close') {
			expect(ctx.partial).toBe('cal');
			expect(ctx.openTags).toContain('callout');
		}
	});

	it('detects ref-root', () => {
		const ctx = detectMarkdownCompletionContext('Value: $ord', '', 11);
		expect(ctx.kind).toBe('ref-root');
		if (ctx.kind === 'ref-root') expect(ctx.partial).toBe('ord');
	});

	it('detects ref-member', () => {
		const ctx = detectMarkdownCompletionContext('{% metric value=$orders.rev', '', 28);
		expect(ctx.kind).toBe('ref-member');
		if (ctx.kind === 'ref-member') {
			expect(ctx.cellName).toBe('orders');
			expect(ctx.partial).toBe('rev');
		}
	});

	it('detects attr-enum inside tag', () => {
		const ctx = detectMarkdownCompletionContext('{% chart type="ba', '', 17);
		expect(ctx.kind).toBe('attr-enum');
		if (ctx.kind === 'attr-enum') {
			expect(ctx.tagName).toBe('chart');
			expect(ctx.attrName).toBe('type');
			expect(ctx.partial).toBe('ba');
		}
	});

	it('detects attr-name after tag whitespace', () => {
		const ctx = detectMarkdownCompletionContext('{% metric val', '', 13);
		expect(ctx.kind).toBe('attr-name');
		if (ctx.kind === 'attr-name') {
			expect(ctx.tagName).toBe('metric');
			expect(ctx.partial).toBe('val');
		}
	});

	it('detects function when partial matches fn not tag', () => {
		const ctx = detectMarkdownCompletionContext('{% curren', '', 10);
		expect(ctx.kind).toBe('function');
		if (ctx.kind === 'function') expect(ctx.partial).toBe('curren');
	});
});
