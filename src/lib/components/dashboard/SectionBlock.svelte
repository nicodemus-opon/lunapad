<script lang="ts">
	import { GripVertical, X } from '@lucide/svelte';
	import type { SectionBlock } from '$lib/types/gui-pipeline';

	interface Props {
		block: SectionBlock;
		onUpdate: (patch: Partial<SectionBlock>) => void;
		onRemove: () => void;
	}

	const { block, onUpdate, onRemove }: Props = $props();

	let editing = $state(false);
	let draft = $state('');

	function startEdit() {
		draft = block.heading;
		editing = true;
	}

	function commit() {
		if (draft.trim()) onUpdate({ heading: draft.trim() });
		editing = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commit();
		if (e.key === 'Escape') editing = false;
	}

	function cycleLevel() {
		onUpdate({ level: block.level === 1 ? 2 : 1 });
	}
</script>

<div class="group/section relative flex items-center gap-3 py-2">
	<!-- Drag handle -->
	<button class="drag-handle cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/section:opacity-100 transition-opacity shrink-0">
		<GripVertical class="w-3.5 h-3.5" />
	</button>

	<!-- Heading -->
	<div class="flex-1 min-w-0">
		{#if editing}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="{block.level === 1 ? 'text-base font-semibold' : 'text-sm font-semibold text-muted-foreground'} bg-transparent focus:outline-none w-full pb-1.5"
				bind:value={draft}
				onblur={commit}
				onkeydown={onKey}
				autofocus
			/>
		{:else}
			<button
				class="{block.level === 1 ? 'text-base font-semibold text-foreground' : 'text-sm font-semibold text-muted-foreground'} text-left w-full pb-1.5 hover:opacity-70 transition-opacity cursor-text"
				onclick={startEdit}
				title="Click to edit heading"
			>{block.heading || 'Section'}</button>
		{/if}
		<div class="border-b border-border/60"></div>
	</div>

	<!-- Hover controls -->
	<div class="flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity shrink-0">
		<button
			class="text-[10px] font-mono px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background"
			onclick={cycleLevel}
			title="Toggle heading level"
		>H{block.level}</button>
		<button
			class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
			onclick={onRemove}
			title="Remove section"
		><X class="w-3 h-3" /></button>
	</div>
</div>
