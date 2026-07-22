<script lang="ts">
	import type { RenderableTreeNode } from '@markdoc/markdoc';
	import MermaidDiagram from './MermaidDiagram.svelte';
	import hljs from 'highlight.js/lib/core';
	import sql from 'highlight.js/lib/languages/sql';
	import python from 'highlight.js/lib/languages/python';
	import javascript from 'highlight.js/lib/languages/javascript';
	import typescript from 'highlight.js/lib/languages/typescript';
	import json from 'highlight.js/lib/languages/json';
	import bash from 'highlight.js/lib/languages/bash';
	import yaml from 'highlight.js/lib/languages/yaml';
	import xml from 'highlight.js/lib/languages/xml';

	hljs.registerLanguage('sql', sql);
	hljs.registerLanguage('python', python);
	hljs.registerLanguage('javascript', javascript);
	hljs.registerLanguage('typescript', typescript);
	hljs.registerLanguage('json', json);
	hljs.registerLanguage('bash', bash);
	hljs.registerLanguage('shell', bash);
	hljs.registerLanguage('yaml', yaml);
	hljs.registerLanguage('xml', xml);
	hljs.registerLanguage('html', xml);

	interface Props {
		lang: string;
		children: RenderableTreeNode[];
	}

	const { lang, children }: Props = $props();

	function extractText(nodes: RenderableTreeNode[]): string {
		return nodes.map((n) => (typeof n === 'string' ? n : '')).join('');
	}

	const rawCode = $derived(extractText(children));

	// hljs.highlight only adds <span class="hljs-*"> tags — no XSS risk.
	const highlighted = $derived.by(() => {
		if (!rawCode) return '';
		if (lang && hljs.getLanguage(lang)) {
			return hljs.highlight(rawCode, { language: lang }).value;
		}
		// No known language — escape HTML manually
		return rawCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	});
</script>

{#if lang === 'mermaid'}
	<MermaidDiagram code={rawCode} />
{:else}
	<pre class="hljs-block"><code class="language-{lang}">{@html highlighted}</code></pre>
{/if}

<style>
	/* Colors below are the exact hex values from the lunapad-light/lunapad-dark Monaco
	   themes (src/lib/monaco/themes.ts) — this block is meant to read as "the same
	   code, out of the editor", so it must match pixel-for-pixel rather than derive
	   from the (brand-customizable) app color tokens. */
	.hljs-block {
		background: #f3f1ea;
		color: #1f1e1b;
		border-radius: var(--radius);
		padding: 0.5rem 0.75rem;
		margin: 0 0 0.5rem;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		font-size: var(--text-2xs);
		line-height: 1.6;
	}
	:global(.dark) .hljs-block {
		background: #1f1e1b;
		color: #c3c0b6;
	}
	.hljs-block code {
		background: none;
		padding: 0;
		border: none;
		font-family: inherit;
		font-size: inherit;
	}
	.hljs-block :global(.hljs-keyword),
	.hljs-block :global(.hljs-selector-tag),
	.hljs-block :global(.hljs-built_in),
	.hljs-block :global(.hljs-tag) {
		color: #2f6f9f;
		font-weight: 700;
	}
	:global(.dark) .hljs-block :global(.hljs-keyword),
	:global(.dark) .hljs-block :global(.hljs-selector-tag),
	:global(.dark) .hljs-block :global(.hljs-built_in),
	:global(.dark) .hljs-block :global(.hljs-tag) {
		color: #7fb8dd;
	}
	.hljs-block :global(.hljs-string),
	.hljs-block :global(.hljs-attr) {
		color: #58804f;
	}
	:global(.dark) .hljs-block :global(.hljs-string),
	:global(.dark) .hljs-block :global(.hljs-attr) {
		color: #a9c49a;
	}
	.hljs-block :global(.hljs-number),
	.hljs-block :global(.hljs-literal) {
		color: #9c6b2e;
	}
	:global(.dark) .hljs-block :global(.hljs-number),
	:global(.dark) .hljs-block :global(.hljs-literal) {
		color: #d4a972;
	}
	.hljs-block :global(.hljs-comment),
	.hljs-block :global(.hljs-quote),
	.hljs-block :global(.hljs-meta) {
		color: #8a8276;
		font-style: italic;
	}
	:global(.dark) .hljs-block :global(.hljs-comment),
	:global(.dark) .hljs-block :global(.hljs-quote),
	:global(.dark) .hljs-block :global(.hljs-meta) {
		color: #8f8a7d;
	}
	.hljs-block :global(.hljs-title),
	.hljs-block :global(.hljs-section),
	.hljs-block :global(.hljs-name) {
		color: #6a5b9e;
	}
	:global(.dark) .hljs-block :global(.hljs-title),
	:global(.dark) .hljs-block :global(.hljs-section),
	:global(.dark) .hljs-block :global(.hljs-name) {
		color: #b1a6d4;
	}
	.hljs-block :global(.hljs-variable),
	.hljs-block :global(.hljs-template-variable) {
		color: #1f1e1b;
	}
	:global(.dark) .hljs-block :global(.hljs-variable),
	:global(.dark) .hljs-block :global(.hljs-template-variable) {
		color: #c3c0b6;
	}
	.hljs-block :global(.hljs-type),
	.hljs-block :global(.hljs-class) {
		color: #2e7d86;
	}
	:global(.dark) .hljs-block :global(.hljs-type),
	:global(.dark) .hljs-block :global(.hljs-class) {
		color: #92c4c4;
	}
</style>
