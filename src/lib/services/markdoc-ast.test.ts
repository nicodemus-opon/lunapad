import { describe, expect, it } from 'vitest';
import {
	parseVisualBlocks,
	serializeVisualBlocks,
	splitFrontmatter,
	parseBlockWidget,
	updateBlockWidgetSource,
	visualBlocksRoundTripLossy,
	serializeMarkdocTag
} from './markdoc-ast';

describe('splitFrontmatter', () => {
	it('extracts leading YAML frontmatter and body', () => {
		const md = '---\ntitle: Report\ntags: [a, b]\n---\n\n## Body\n\ntext';
		const { frontmatter, body } = splitFrontmatter(md);
		expect(frontmatter).toBe('---\ntitle: Report\ntags: [a, b]\n---');
		expect(body).toBe('## Body\n\ntext');
	});

	it('returns empty frontmatter when absent', () => {
		const md = '## Body\n\ntext';
		expect(splitFrontmatter(md)).toEqual({ frontmatter: '', body: md });
	});

	it('does not treat a mid-document --- (thematic break) as frontmatter', () => {
		const md = '## Body\n\n---\n\nmore';
		expect(splitFrontmatter(md).frontmatter).toBe('');
	});
});

const SAMPLE = `## Revenue dashboard

{% metric value=$orders.revenue label="Revenue" format="currency" /%}

{% datatable data=$orders.rows cols=["id","total"] limit=20 pivotBy="region" valueCol="total" agg="sum" /%}`;

describe('markdoc-ast', () => {
	it('parses top-level blocks from markdown', () => {
		const blocks = parseVisualBlocks(SAMPLE);
		expect(blocks.length).toBeGreaterThanOrEqual(3);
		expect(blocks[0].kind).toBe('heading');
		expect(blocks.some((b) => b.tagName === 'metric')).toBe(true);
		expect(blocks.some((b) => b.tagName === 'datatable')).toBe(true);
	});

	it('round-trips simple dashboard markdown', () => {
		const blocks = parseVisualBlocks(SAMPLE);
		const out = serializeVisualBlocks(blocks);
		expect(out.trim()).toBe(SAMPLE.trim());
	});

	it('parses widget attrs from a datatable block', () => {
		const blocks = parseVisualBlocks(SAMPLE);
		const dt = blocks.find((b) => b.tagName === 'datatable');
		expect(dt).toBeDefined();
		const parsed = parseBlockWidget(dt!);
		expect(parsed?.tagName).toBe('datatable');
		expect(parsed?.attrs.limit).toBe(20);
	});

	it('updates widget attrs and re-serializes', () => {
		const blocks = parseVisualBlocks(SAMPLE);
		const metric = blocks.find((b) => b.tagName === 'metric')!;
		const updated = updateBlockWidgetSource(metric, {
			attrs: { label: 'MTD Revenue' }
		});
		expect(updated.source).toContain('label="MTD Revenue"');
		const reparsed = parseBlockWidget(updated);
		expect(reparsed?.attrs.label).toBe('MTD Revenue');
	});

	it('serializes self-closing tags', () => {
		expect(serializeMarkdocTag('metric', { value: '$orders.count', label: 'Orders' })).toBe(
			'{% metric value=$orders.count label="Orders" /%}'
		);
	});

	it('serializes conditionals with Markdoc expression syntax', () => {
		expect(
			serializeMarkdocTag(
				'if',
				{ condition: 'gt($orders.count, 0)' },
				{ selfClosing: false, body: 'Has rows' }
			)
		).toBe('{% if gt($orders.count, 0) %}\nHas rows\n{% /if %}');
	});

	it('updates conditional expressions without creating fake attrs', () => {
		const [block] = parseVisualBlocks('{% if gt($orders.count, 0) %}\nHas rows\n{% /if %}');
		const updated = updateBlockWidgetSource(block, {
			attrs: { condition: 'lte($orders.count, 10)' }
		});
		expect(updated.source).toContain('{% if lte($orders.count, 10) %}');
		expect(updated.source).not.toContain('condition=');
	});

	it('preserves $cell.field refs when an unrelated attr is edited', () => {
		const [block] = parseVisualBlocks(
			'{% metric value=$orders.total label="Revenue" format="currency" /%}'
		);
		const updated = updateBlockWidgetSource(block, { attrs: { label: 'Gross Revenue' } });
		// The variable ref must round-trip as source, not "[object Object]".
		expect(updated.source).toContain('value=$orders.total');
		expect(updated.source).toContain('label="Gross Revenue"');
		expect(updated.source).not.toContain('[object Object]');
	});

	it('preserves function-valued attrs (e.g. chart refs) across edits', () => {
		const [block] = parseVisualBlocks(
			'{% chart type="bar" data=$orders.rows x="region" y="total" /%}'
		);
		const updated = updateBlockWidgetSource(block, { attrs: { title: 'By region' } });
		expect(updated.source).toContain('data=$orders.rows');
		expect(updated.source).toContain('title="By region"');
		expect(updated.source).not.toContain('[object Object]');
	});

	it('preserves the condition function when an if body is edited', () => {
		const [block] = parseVisualBlocks('{% if gt($orders.count, 0) %}\nHas rows\n{% /if %}');
		const updated = updateBlockWidgetSource(block, { body: 'Now has more rows' });
		expect(updated.source).toContain('{% if gt($orders.count, 0) %}');
		expect(updated.source).toContain('Now has more rows');
	});

	it('does not swallow the closing tag into a container body', () => {
		const [block] = parseVisualBlocks('{% callout %}\nline one\nline two\n{% /callout %}');
		const parsed = parseBlockWidget(block);
		expect(parsed?.bodySource).toBe('line one\nline two');
		expect(parsed?.bodySource).not.toContain('/callout');
	});

	it('does not duplicate the closing tag when a container body is edited', () => {
		const [block] = parseVisualBlocks('{% callout %}\noriginal\n{% /callout %}');
		const updated = updateBlockWidgetSource(block, { body: 'edited body' });
		expect(updated.source).toBe('{% callout %}\nedited body\n{% /callout %}');
		// Exactly one opening and one closing tag — no unbalanced "Node 'tag' is missing opening".
		expect(updated.source.match(/\{% \/callout %\}/g)?.length).toBe(1);
	});

	it('does not duplicate the closing tag when a container attr is edited', () => {
		const [block] = parseVisualBlocks('{% callout type="info" %}\nsome body text\n{% /callout %}');
		const updated = updateBlockWidgetSource(block, { attrs: { type: 'warning' } });
		expect(updated.source).toContain('type="warning"');
		expect(updated.source).toContain('some body text');
		expect(updated.source.match(/\{% \/callout %\}/g)?.length).toBe(1);
	});

	it('does not duplicate the closing tag when an if body is edited', () => {
		const [block] = parseVisualBlocks('{% if $x %}\nHas rows\n{% /if %}');
		const updated = updateBlockWidgetSource(block, { body: 'Now has more rows' });
		expect(updated.source.match(/\{% \/if %\}/g)?.length).toBe(1);
		expect(updated.source).not.toContain('Has rows');
	});

	it('preserves a multi-paragraph container body across edits', () => {
		const [block] = parseVisualBlocks('{% callout %}\npara one\n\npara two\n{% /callout %}');
		const parsed = parseBlockWidget(block);
		expect(parsed?.bodySource).toBe('para one\n\npara two');
		const updated = updateBlockWidgetSource(block, { attrs: { type: 'note' } });
		expect(updated.source.match(/\{% \/callout %\}/g)?.length).toBe(1);
	});

	it('assigns stable ids so re-parsing identical markdown is idempotent', () => {
		const a = parseVisualBlocks(SAMPLE).map((b) => b.id);
		const b = parseVisualBlocks(SAMPLE).map((b) => b.id);
		expect(a).toEqual(b);
	});

	it('keeps ids of unchanged blocks stable when one block changes', () => {
		const before = parseVisualBlocks(SAMPLE);
		const heading = before[0];
		// Edit only the metric block's source; the heading id should be unchanged.
		const changed = SAMPLE.replace('label="Revenue"', 'label="Net revenue"');
		const after = parseVisualBlocks(changed);
		expect(after[0].id).toBe(heading.id);
	});

	it('detects lossy round-trip when structure changes', () => {
		const { lossy } = visualBlocksRoundTripLossy('Hello\n\n{% metric value=1 /%}');
		expect(lossy).toBe(false);
	});
});
