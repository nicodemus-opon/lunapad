<script lang="ts">
	import { marked } from 'marked';
	import { GripVertical, X, AlignLeft } from '@lucide/svelte';
	import type { TextBlock } from '$lib/types/gui-pipeline';
	import { interpolate, type QueryResults } from '$lib/services/dashboard-interpolate';
	import type { DashboardPanelWidth } from '$lib/types/gui-pipeline';

	interface Props {
		block: TextBlock;
		results: QueryResults;
		onUpdate: (markdown: string) => void;
		onRemove: () => void;
		onCycleWidth: () => void;
	}

	const { block, results, onUpdate, onRemove, onCycleWidth }: Props = $props();

	let editing = $state(false);
	let draft = $state('');

	const rendered = $derived(() => {
		const interpolated = interpolate(block.markdown, results);
		return marked.parse(interpolated) as string;
	});

	const WIDTH_LABELS: Record<DashboardPanelWidth, string> = { 1: 'S', 2: 'M', 3: 'L' };

	function startEdit() {
		draft = block.markdown;
		editing = true;
	}

	function commit() {
		if (draft !== block.markdown) onUpdate(draft);
		editing = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			editing = false;
		}
	}
</script>

<div class="group/block relative rounded-lg bg-card overflow-hidden">
	<!-- Hover controls -->
	<div class="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<button
			class="text-[10px] font-mono px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background"
			onclick={onCycleWidth}
			title="Cycle width"
		>{WIDTH_LABELS[block.width]}</button>
		<button
			class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors bg-background"
			onclick={onRemove}
			title="Remove block"
		><X class="w-3 h-3" /></button>
	</div>

	<!-- Drag handle -->
	<button class="drag-handle absolute left-1 top-1 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<GripVertical class="w-3.5 h-3.5" />
	</button>

	{#if editing}
		<div class="p-2">
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				class="w-full min-h-24 rounded border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
				bind:value={draft}
				onblur={commit}
				onkeydown={onKey}
				placeholder="Write markdown… Use {'{'}queryName.columnName{'}'} to embed live values."
				autofocus
			></textarea>
			<div class="flex justify-end gap-2 mt-1">
				<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => (editing = false)}>Cancel</button>
				<button class="text-xs text-primary hover:text-primary/80" onclick={commit}>Done</button>
			</div>
		</div>
	{:else}
		<button
			class="w-full text-left px-4 py-3 min-h-10 cursor-text"
			onclick={startEdit}
			title="Click to edit"
		>
			{#if block.markdown.trim()}
				<div class="prose prose-sm dark:prose-invert max-w-none">
					{@html rendered()}
				</div>
			{:else}
				<div class="flex items-center gap-2 text-muted-foreground/50 text-xs py-2">
					<AlignLeft class="w-4 h-4" />
					Click to add markdown text…
				</div>
			{/if}
		</button>
	{/if}
</div>
