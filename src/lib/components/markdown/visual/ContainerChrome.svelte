<script lang="ts">
	import { Trash2, Minus, Plus, Copy } from '@lucide/svelte';

	interface Props {
		tagName: string;
		attrs: Record<string, unknown>;
		selected?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
		onPatchAttrs?: (patch: Record<string, unknown>) => void;
		onAddChild?: () => void;
	}

	const {
		tagName,
		attrs,
		selected = false,
		onSelect,
		onDelete,
		onPatchAttrs,
		onAddChild
	}: Props = $props();

	const label = $derived.by(() => {
		if (tagName === 'callout') return `Callout (${attrs.type ?? 'info'})`;
		if (tagName === 'card') return String(attrs.title ?? 'Card');
		if (tagName === 'details') return String(attrs.summary ?? 'Details');
		if (tagName === 'tab') return String(attrs.label ?? 'Tab');
		if (tagName === 'grid') return 'Grid';
		if (tagName === 'columns') return 'Columns';
		if (tagName === 'column') return 'Column';
		if (tagName === 'tabs') return 'Tabs';
		if (tagName === 'mermaid') return 'Mermaid';
		if (tagName === 'if') return 'Conditional';
		if (tagName === 'each') return 'Each loop';
		if (tagName === 'group') return 'Group';
		return tagName;
	});

	const gridCols = $derived(Number(attrs.cols ?? 3));

	function setGridCols(next: number) {
		onPatchAttrs?.({ cols: Math.max(1, Math.min(6, next)) });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="container-chrome flex items-center gap-1 px-1 py-0.5 text-2xs opacity-0 transition-opacity group-hover/container:opacity-100 {selected
		? 'opacity-100'
		: ''}"
	role="button"
	tabindex="0"
	onclick={() => onSelect?.()}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.();
		}
	}}
>
	<span class="font-medium text-muted-foreground">{label}</span>

	{#if tagName === 'grid' && onPatchAttrs}
		<div class="flex items-center gap-0.5 rounded-sm border bg-background/80 px-0.5">
			<button
				type="button"
				class="md-action"
				title="Fewer columns"
				onclick={(e) => {
					e.stopPropagation();
					setGridCols(gridCols - 1);
				}}
			>
				<Minus class="h-3 w-3" />
			</button>
			<span class="min-w-4 text-center tabular-nums">{gridCols}</span>
			<button
				type="button"
				class="md-action"
				title="More columns"
				onclick={(e) => {
					e.stopPropagation();
					setGridCols(gridCols + 1);
				}}
			>
				<Plus class="h-3 w-3" />
			</button>
		</div>
	{/if}

	{#if (tagName === 'columns' || tagName === 'tabs') && onAddChild}
		<button
			type="button"
			class="md-action rounded-sm border bg-background/80 px-1.5 py-0.5 text-2xs font-medium"
			title={tagName === 'columns' ? 'Add column' : 'Add tab'}
			onclick={(e) => {
				e.stopPropagation();
				onAddChild();
			}}
		>
			{tagName === 'columns' ? 'Add column' : 'Add tab'}
		</button>
	{/if}

	<span class="flex-1"></span>
	<button
		type="button"
		class="md-action"
		title="Select"
		onclick={(e) => {
			e.stopPropagation();
			onSelect?.();
		}}
	>
		<Copy class="h-3 w-3" />
	</button>
	<button
		type="button"
		class="md-action md-action--danger"
		title="Delete container"
		onclick={(e) => {
			e.stopPropagation();
			onDelete?.();
		}}
	>
		<Trash2 class="h-3 w-3" />
	</button>
</div>
