<script lang="ts">
	import type { VisualBlock } from '$lib/services/markdoc-ast';
	import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/svelte';

	interface Props {
		block: VisualBlock;
		selected?: boolean;
		onselect?: () => void;
		ondelete?: () => void;
		onmoveup?: () => void;
		onmovedown?: () => void;
		oninsertbelow?: () => void;
		children?: import('svelte').Snippet;
	}

	const {
		block,
		selected = false,
		onselect,
		ondelete,
		onmoveup,
		onmovedown,
		oninsertbelow,
		children
	}: Props = $props();
</script>

<div
	class="visual-block group/block relative rounded-md border transition-colors duration-100 {selected
		? 'border-ring/60 ring-2 ring-ring/40'
		: 'border-transparent hover:border-border/60 hover:bg-muted/20'}"
	role="button"
	tabindex="0"
	onclick={(e) => {
		if ((e.target as HTMLElement).closest('.block-chrome')) return;
		onselect?.();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		onselect?.();
	}}
>
	<div class="block-chrome absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 {selected
		? 'opacity-100'
		: ''}">
		<button
			type="button"
			class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
			title="Move up"
			onclick={(e) => {
				e.stopPropagation();
				onmoveup?.();
			}}
		>
			<ArrowUp class="h-3 w-3" />
		</button>
		<button
			type="button"
			class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
			title="Move down"
			onclick={(e) => {
				e.stopPropagation();
				onmovedown?.();
			}}
		>
			<ArrowDown class="h-3 w-3" />
		</button>
		<button
			type="button"
			class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
			title="Insert below"
			onclick={(e) => {
				e.stopPropagation();
				oninsertbelow?.();
			}}
		>
			<Plus class="h-3 w-3" />
		</button>
		<button
			type="button"
			class="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
			title="Delete block"
			onclick={(e) => {
				e.stopPropagation();
				ondelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</button>
	</div>
	<div class="block-preview px-1 py-0.5">
		{@render children?.()}
	</div>
</div>
