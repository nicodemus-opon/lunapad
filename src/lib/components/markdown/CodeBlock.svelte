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
	.hljs-block {
		background: color-mix(in oklch, currentColor 6%, transparent);
		border-radius: 0.3rem;
		padding: 0.5rem 0.75rem;
		margin: 0 0 0.5rem;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		font-size: 0.82em;
		line-height: 1.6;
	}
	.hljs-block code {
		background: none;
		padding: 0;
		border: none;
		font-family: inherit;
		font-size: inherit;
	}
	/* Syntax token colors — bound to app CSS tokens for automatic dark/light support */
	.hljs-block :global(.hljs-keyword),
	.hljs-block :global(.hljs-selector-tag),
	.hljs-block :global(.hljs-built_in) {
		color: var(--primary);
		font-weight: 600;
	}
	.hljs-block :global(.hljs-string),
	.hljs-block :global(.hljs-attr) {
		color: var(--chart-2, #16a34a);
	}
	.hljs-block :global(.hljs-number),
	.hljs-block :global(.hljs-literal) {
		color: var(--chart-1, #2563eb);
	}
	.hljs-block :global(.hljs-comment),
	.hljs-block :global(.hljs-quote) {
		color: var(--muted-foreground);
		font-style: italic;
	}
	.hljs-block :global(.hljs-title),
	.hljs-block :global(.hljs-section),
	.hljs-block :global(.hljs-name) {
		color: var(--chart-4, #d97706);
	}
	.hljs-block :global(.hljs-variable),
	.hljs-block :global(.hljs-template-variable) {
		color: var(--chart-3, #db2777);
	}
	.hljs-block :global(.hljs-type),
	.hljs-block :global(.hljs-class) {
		color: var(--chart-4, #d97706);
	}
	.hljs-block :global(.hljs-meta) {
		color: var(--muted-foreground);
	}
	.hljs-block :global(.hljs-tag) {
		color: var(--primary);
	}
</style>
