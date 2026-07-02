import { describe, expect, it } from 'vitest';
import Markdoc from '@markdoc/markdoc';
import {
	parseVisualBlocks,
	parseBlockWidget,
	updateBlockWidgetSource,
	type VisualBlock
} from './markdoc-ast';

const CONTAINER_TAGS = new Set([
	'columns',
	'column',
	'grid',
	'callout',
	'card',
	'details',
	'tabs',
	'tab',
	'mermaid',
	'each',
	'group',
	'if'
]);

function parseErrors(source: string): string[] {
	const ast = Markdoc.parse(source);
	const out: string[] = [];
	const walk = (n: unknown) => {
		if (!n || typeof n !== 'object') return;
		const node = n as { errors?: Array<{ id: string; message: string }>; children?: unknown[] };
		if (Array.isArray(node.errors)) {
			for (const e of node.errors) out.push(`${e.id}: ${e.message}`);
		}
		for (const c of node.children ?? []) walk(c);
	};
	walk(ast);
	return out;
}

function closeTagCount(source: string, tag: string): number {
	return source.match(new RegExp(`\\{% /${tag} %\\}`, 'g'))?.length ?? 0;
}

/**
 * Every tag rendered by the visual inspector, a valid starting source, and a
 * representative edit (mirroring what the inspector's controls emit). Each case
 * must survive a parse → edit → re-serialize → re-parse round trip without
 * producing Markdoc parse errors or duplicated closing tags.
 */
interface Case {
	tag: string;
	source: string;
	patch: { attrs?: Record<string, unknown>; body?: string };
	expect?: (updated: VisualBlock) => void;
}

const CASES: Case[] = [
	// --- self-closing widgets ---
	{
		tag: 'metric',
		source: '{% metric value=$o.revenue label="Revenue" format="currency" /%}',
		patch: { attrs: { label: 'MTD Revenue' } }
	},
	{
		tag: 'metric',
		source: '{% metric value=$o.revenue label="Revenue" /%}',
		patch: { attrs: { vs: '$prev.revenue' } }
	},
	{
		tag: 'chart',
		source: '{% chart type="bar" data=$o.rows x="region" y="total" /%}',
		patch: { attrs: { title: 'By region' } }
	},
	{
		tag: 'chart',
		source: '{% chart type="bar" data=$o.rows x="region" y="total" /%}',
		patch: { attrs: { yColumns: ['a', 'b'] } }
	},
	{
		tag: 'datatable',
		source: '{% datatable data=$o.rows cols=["id","total"] limit=20 /%}',
		patch: { attrs: { cols: ['id', 'total', 'region'] } }
	},
	{
		tag: 'datatable',
		source: '{% datatable data=$o.rows /%}',
		patch: { attrs: { pivotBy: 'region', valueCol: 'total', agg: 'sum' } }
	},
	{
		tag: 'badge',
		source: '{% badge value=$o.status color="info" /%}',
		patch: { attrs: { color: 'success' } }
	},
	{
		tag: 'progress',
		source: '{% progress value=$o.done max=100 label="Done" /%}',
		patch: { attrs: { label: 'Completed' } }
	},
	{
		tag: 'filter',
		source: '{% filter param="region" kind="dropdown" label="Region" /%}',
		patch: { attrs: { options: ['North', 'South'] } }
	},
	{
		tag: 'filter',
		source: '{% filter param="region" kind="dropdown" /%}',
		patch: { attrs: { options: '$o.rows' } }
	},
	// --- containers (have a body) ---
	{
		tag: 'callout',
		source: '{% callout type="info" %}\nHeads up.\n{% /callout %}',
		patch: { attrs: { type: 'warning' } }
	},
	{
		tag: 'callout',
		source: '{% callout %}\nHeads up.\n{% /callout %}',
		patch: { body: 'New **body** text (⇧⌘R).' }
	},
	{
		tag: 'card',
		source: '{% card title="Sales" %}\nContent.\n{% /card %}',
		patch: { attrs: { title: 'Revenue' } }
	},
	{
		tag: 'grid',
		source: '{% grid cols=3 %}\n{% metric value=1 /%}\n{% /grid %}',
		patch: { attrs: { cols: 4 } }
	},
	{
		tag: 'columns',
		source: '{% columns %}\n{% column %}\nA\n{% /column %}\n{% /columns %}',
		patch: { body: '{% column %}\nB\n{% /column %}' }
	},
	{
		tag: 'column',
		source: '{% column width="40%" %}\nA\n{% /column %}',
		patch: { attrs: { width: '50%' } }
	},
	{
		tag: 'details',
		source: '{% details summary="More" %}\nHidden.\n{% /details %}',
		patch: { attrs: { open: true } }
	},
	{
		tag: 'details',
		source: '{% details summary="More" open=true %}\nHidden.\n{% /details %}',
		patch: { attrs: { open: false } }
	},
	{
		tag: 'tabs',
		source: '{% tabs %}\n{% tab label="One" %}\nA\n{% /tab %}\n{% /tabs %}',
		patch: { body: '{% tab label="Two" %}\nB\n{% /tab %}' }
	},
	{
		tag: 'tab',
		source: '{% tab label="One" %}\nA\n{% /tab %}',
		patch: { attrs: { label: 'First' } }
	},
	{
		tag: 'group',
		source: '{% group data=$o.rows by="region" %}\nBody\n{% /group %}',
		patch: { attrs: { by: 'country' } }
	},
	{
		tag: 'group',
		source: '{% group data=$o.rows by="region" %}\nBody\n{% /group %}',
		patch: { attrs: { order: ['A', 'B'] } }
	},
	{
		tag: 'each',
		source: '{% each data=$items %}\nItem\n{% /each %}',
		patch: { body: 'Item {{ }}' }
	},
	{
		tag: 'mermaid',
		source: '{% mermaid %}\ngraph TD; A-->B;\n{% /mermaid %}',
		patch: { body: 'graph TD; A-->B; B-->C;' }
	},
	{
		tag: 'if',
		source: '{% if gt($o.count, 0) %}\nHas rows\n{% /if %}',
		patch: { body: 'Now has more rows' }
	},
	{
		tag: 'if',
		source: '{% if gt($o.count, 0) %}\nHas rows\n{% /if %}',
		patch: { attrs: { condition: 'lte($o.count, 10)' } }
	},
	{
		tag: 'if',
		source: '{% if $x %}\nyes\n{% else /%}\nno\n{% /if %}',
		patch: { body: 'maybe\n{% else /%}\nnope' }
	}
];

describe('visual inspector edit round-trips', () => {
	for (const c of CASES) {
		const desc = c.patch.body !== undefined ? 'body' : Object.keys(c.patch.attrs ?? {}).join(',');
		it(`${c.tag}: editing ${desc} produces valid markdoc`, () => {
			const [block] = parseVisualBlocks(c.source);
			expect(block, `parseVisualBlocks failed for ${c.tag}`).toBeDefined();

			const updated = updateBlockWidgetSource(block, c.patch);

			// 1. The re-serialized source must parse without Markdoc errors.
			expect(parseErrors(updated.source), `parse errors for ${c.tag} (${updated.source})`).toEqual(
				[]
			);

			// 2. Containers must have exactly one closing tag (regression: the body
			//    must not swallow the closing tag and get a second one appended).
			if (CONTAINER_TAGS.has(c.tag)) {
				expect(closeTagCount(updated.source, c.tag), `duplicate /${c.tag} close`).toBe(1);
			}

			// 3. The patched values must round-trip back through parseBlockWidget.
			const reparsed = parseBlockWidget(updated);
			expect(reparsed, `re-parse failed for ${c.tag}`).not.toBeNull();
			if (c.patch.attrs) {
				for (const [k, v] of Object.entries(c.patch.attrs)) {
					if (c.tag === 'if' && k === 'condition') {
						expect(updated.source).toContain(String(v));
					} else if (typeof v === 'string' && v.startsWith('$')) {
						// $cell refs round-trip as Markdoc Variable nodes, re-serialized to source.
						expect(updated.source).toContain(`${k}=${v}`);
					} else {
						expect(reparsed!.attrs[k], `attr ${k} for ${c.tag}`).toStrictEqual(v);
					}
				}
			}
			if (c.patch.body !== undefined) {
				expect(reparsed!.bodySource.trim()).toBe(c.patch.body.trim());
			}

			c.expect?.(updated);
		});
	}

	it('drops NaN number attrs instead of emitting invalid `attr=NaN`', () => {
		const [block] = parseVisualBlocks('{% chart type="bar" data=$o.rows height=280 /%}');
		// Mirrors the inspector during a mid-edit number field: Number('-') / Number('1e') → NaN.
		const updated = updateBlockWidgetSource(block, { attrs: { height: Number('-') } });
		expect(updated.source).not.toContain('NaN');
		expect(parseErrors(updated.source)).toEqual([]);
	});
});
