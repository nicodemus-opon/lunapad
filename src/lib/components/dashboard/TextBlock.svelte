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
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

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
		if (e.key === 'Escape') commit();
		// Allow Enter for new lines — don't intercept it
	}

	// Auto-resize textarea
	function autoResize(el: HTMLTextAreaElement) {
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	}

	$effect(() => {
		if (editing && textareaEl) {
			textareaEl.focus();
			autoResize(textareaEl);
		}
	});
</script>

<div class="group/block relative rounded-xl border border-border/60 bg-card surface-raised overflow-hidden transition-[box-shadow,border-color] duration-(--motion-medium) hover:shadow-md hover:border-border/75">
	<!-- Hover controls -->
	<div class="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
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
	<button class="drag-handle absolute left-1.5 top-1.5 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<GripVertical class="w-3.5 h-3.5" />
	</button>

	{#if editing}
		<!-- Inline textarea — no form chrome, just text on the card -->
		<textarea
			bind:this={textareaEl}
			class="w-full px-5 py-4 font-mono text-xs text-foreground bg-transparent focus:outline-none resize-none min-h-16 leading-relaxed"
			bind:value={draft}
			onblur={commit}
			onkeydown={onKey}
			oninput={(e) => autoResize(e.currentTarget)}
			placeholder="Write markdown… Use {'{'}queryName.columnName{'}'} to embed live values."
		></textarea>
	{:else}
		<button
			class="w-full text-left px-5 py-4 min-h-16 cursor-text"
			onclick={startEdit}
			title="Click to edit"
		>
			{#if block.markdown.trim()}
				<div class="prose prose-sm dark:prose-invert max-w-none">
					{@html rendered()}
				</div>
			{:else}
				<div class="flex items-center gap-2 text-muted-foreground/35 text-xs py-1 select-none">
					<AlignLeft class="w-3.5 h-3.5" />
					Click to add text…
				</div>
			{/if}
		</button>
	{/if}
</div>
