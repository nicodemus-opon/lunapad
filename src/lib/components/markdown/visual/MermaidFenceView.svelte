<script lang="ts">
	import MarkdownModeBar from '../MarkdownModeBar.svelte';
	import MermaidDiagram from '../MermaidDiagram.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Trash2 } from '@lucide/svelte';
	import { mermaidCodeFromFenceSource } from './mermaid-code';

	interface Props {
		source: string;
		selected?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
	}

	let { source, selected = false, onSelect, onDelete }: Props = $props();

	let mode = $state<'visual' | 'source'>('visual');
	const code = $derived(mermaidCodeFromFenceSource(source));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="mermaid-fence-view group/mdf relative rounded-sm border transition-colors duration-(--motion-fast) {selected
		? 'border-ring bg-muted/10'
		: 'border-transparent hover:border-border hover:bg-muted/15'}"
	role="button"
	tabindex="0"
	onclick={(e) => {
		if ((e.target as HTMLElement).closest('.markdown-mode-bar, .mdf-chrome')) return;
		onSelect?.();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		onSelect?.();
	}}
>
	<div
		class="mdf-chrome absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-focus-within/mdf:opacity-100 group-hover/mdf:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			class="md-action md-action--danger"
			title="Delete block"
			onclick={(e) => {
				e.stopPropagation();
				onDelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</Button>
	</div>
	<div class="px-1 py-0.5">
		<MarkdownModeBar {mode} onModeChange={(m) => (mode = m)} />
		{#if mode === 'visual'}
			<MermaidDiagram {code} />
		{:else}
			<pre class="mermaid-fence-source">{source.trimEnd()}</pre>
		{/if}
	</div>
</div>

<style>
	.mermaid-fence-view {
		margin: 0.35rem 0;
	}
	.mermaid-fence-source {
		margin: 0.35rem 0 0;
		padding: 0.55rem 0.65rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: color-mix(in oklab, var(--muted) 35%, transparent);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--text-2xs);
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-x: auto;
	}
</style>
