<script lang="ts">
	import { GripVertical, X, TrendingUp, TrendingDown } from '@lucide/svelte';
	import type { KpiBlock } from '$lib/types/gui-pipeline';
	import { interpolate, type QueryResults } from '$lib/services/dashboard-interpolate';

	interface Props {
		block: KpiBlock;
		results: QueryResults;
		onUpdate: (patch: Partial<KpiBlock>) => void;
		onRemove: () => void;
		onCycleWidth: () => void;
	}

	const { block, results, onUpdate, onRemove, onCycleWidth }: Props = $props();

	const rawValue = $derived(interpolate(block.valueExpr, results));
	const rawChange = $derived(block.changeExpr ? interpolate(block.changeExpr, results) : null);

	const displayValue = $derived(() => {
		const v = rawValue;
		const prefix = block.prefix ?? '';
		const suffix = block.suffix ?? '';
		if (v === block.valueExpr) return `${prefix}—${suffix}`;
		return `${prefix}${v}${suffix}`;
	});

	const changeNum = $derived(() => {
		if (!rawChange || rawChange === block.changeExpr) return null;
		return parseFloat(rawChange);
	});

	const isResolved = $derived(rawValue !== block.valueExpr);

	// Inline label editing
	let editingLabel = $state(false);
	let labelDraft = $state('');

	function startLabelEdit() {
		labelDraft = block.label;
		editingLabel = true;
	}

	function commitLabel() {
		if (labelDraft.trim()) onUpdate({ label: labelDraft.trim() });
		editingLabel = false;
	}

	function onLabelKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitLabel();
		if (e.key === 'Escape') editingLabel = false;
	}

	// Value expr editing
	let editingExpr = $state(false);
	let exprDraft = $state('');

	function startExprEdit() {
		exprDraft = block.valueExpr;
		editingExpr = true;
	}

	function commitExpr() {
		if (exprDraft.trim()) onUpdate({ valueExpr: exprDraft.trim() });
		editingExpr = false;
	}

	function onExprKey(e: KeyboardEvent) {
		if (e.key === 'Enter') commitExpr();
		if (e.key === 'Escape') editingExpr = false;
	}
</script>

<div class="group/block relative rounded-xl border border-border/60 bg-card surface-raised overflow-hidden transition-[box-shadow,border-color] duration-(--motion-medium) hover:shadow-md hover:border-border/75 px-5 py-4 flex flex-col gap-1.5 min-h-20">
	<!-- Hover controls -->
	<div class="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<button
			class="text-[10px] font-mono px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background"
			onclick={onCycleWidth}
			title="Cycle width"
		>{block.width === 1 ? 'S' : block.width === 2 ? 'M' : 'L'}</button>
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

	<!-- Label -->
	{#if editingLabel}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="text-2xs font-semibold text-muted-foreground/80 bg-transparent border-b border-primary focus:outline-none w-full"
			bind:value={labelDraft}
			onblur={commitLabel}
			onkeydown={onLabelKey}
			autofocus
		/>
	{:else}
		<button
			class="text-2xs font-semibold text-muted-foreground/80 text-left hover:text-foreground transition-colors"
			onclick={startLabelEdit}
			title="Click to edit label"
		>{block.label || 'Label'}</button>
	{/if}

	<!-- Value -->
	<div class="flex items-end gap-3">
		{#if editingExpr}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="text-2xl font-bold font-mono tabular-nums bg-transparent border-b border-primary focus:outline-none flex-1 min-w-0"
				bind:value={exprDraft}
				onblur={commitExpr}
				onkeydown={onExprKey}
				placeholder="{'{'}query.column{'}'}"
				autofocus
			/>
		{:else}
			<button
				class="text-2xl font-bold font-mono tabular-nums leading-none text-left {isResolved ? 'text-foreground' : 'text-muted-foreground/30'} hover:opacity-70 transition-opacity"
				onclick={startExprEdit}
				title="Click to edit value expression"
			>{displayValue()}</button>
		{/if}

		{#if changeNum() !== null}
			{@const n = changeNum()!}
			<div class="flex items-center gap-0.5 mb-0.5 text-xs font-medium {n >= 0 ? 'text-success' : 'text-destructive'}">
				{#if n >= 0}
					<TrendingUp class="w-3 h-3" />
				{:else}
					<TrendingDown class="w-3 h-3" />
				{/if}
				<span>{Math.abs(n).toFixed(1)}%</span>
			</div>
		{/if}
	</div>

	{#if !isResolved && !editingExpr}
		<p class="text-[10px] text-muted-foreground/50">
			Enter <span class="font-mono">{'{'}query.column{'}'}</span> to bind a live value
		</p>
	{/if}
</div>
