import { describe, expect, it } from 'vitest';
import {
	isMermaidFenceSource,
	mermaidCodeFromContainerNode,
	mermaidCodeFromFenceSource
} from './mermaid-code';
import { getMarkdocPmSchema } from '$lib/services/markdoc-pm';

describe('mermaid-code', () => {
	it('extracts code from a mermaid fence block', () => {
		const src = '```mermaid\nflowchart LR\n  A --> B\n```';
		expect(isMermaidFenceSource(src)).toBe(true);
		expect(mermaidCodeFromFenceSource(src)).toBe('flowchart LR\n  A --> B');
	});

	it('extracts code from a mermaid PM container', () => {
		const fakeNode = {
			forEach(fn: (child: { type: { name: string }; textContent: string }) => void) {
				fn({ type: { name: 'codeBlock' }, textContent: 'graph TD\n  X-->Y' });
			}
		};
		expect(mermaidCodeFromContainerNode(fakeNode as never, '{}')).toBe('graph TD\n  X-->Y');
	});

	it('resolves $variable code refs from cells', () => {
		const schema = getMarkdocPmSchema();
		const attrsJson = JSON.stringify({ code: '$orders.diagram' });
		const node = schema.node(
			'markdocContainer',
			{ tagName: 'mermaid', attrsJson },
			[schema.node('paragraph')]
		);
		const cells = [
			{
				cellType: 'query',
				outputName: 'orders',
				result: { rows: [{ diagram: 'flowchart LR\n  A-->B' }], columns: ['diagram'] }
			}
		] as never[];
		expect(mermaidCodeFromContainerNode(node, attrsJson, cells)).toBe(
			'flowchart LR\n  A-->B'
		);
	});

	it('interpolates bare $var refs in the body text (visual editor live preview)', () => {
		const fakeNode = {
			forEach(fn: (child: { type: { name: string }; textContent: string }) => void) {
				fn({
					type: { name: 'codeBlock' },
					textContent: 'flowchart LR\n  A[$orders.count orders] --> B'
				});
			}
		};
		const cells = [
			{
				cellType: 'query',
				outputName: 'orders',
				result: { rows: [{ count: 42 }], columns: ['count'] }
			}
		] as never[];
		expect(mermaidCodeFromContainerNode(fakeNode as never, '{}', cells)).toBe(
			'flowchart LR\n  A[42 orders] --> B'
		);
	});

	it('expands {% each %} loops in the body text (visual editor live preview)', () => {
		const fakeNode = {
			forEach(fn: (child: { type: { name: string }; textContent: string }) => void) {
				fn({
					type: { name: 'codeBlock' },
					textContent: 'flowchart LR\n{% each data=$orders.rows %}\n  $item.id[$item.name]\n{% /each %}'
				});
			}
		};
		const cells = [
			{
				cellType: 'query',
				outputName: 'orders',
				result: {
					rows: [
						{ id: 'a', name: 'Alpha' },
						{ id: 'b', name: 'Beta' }
					],
					columns: ['id', 'name']
				}
			}
		] as never[];
		const result = mermaidCodeFromContainerNode(fakeNode as never, '{}', cells);
		expect(result).toContain('Alpha');
		expect(result).toContain('Beta');
		expect(result).not.toContain('{% each');
	});
});
