<script lang="ts">
	import { GripVertical, X } from '@lucide/svelte';
	import type { FilterBlock } from '$lib/types/gui-pipeline';

	interface Props {
		block: FilterBlock;
		value: string;
		onChange: (v: string) => void;
		onRemove?: () => void;
		onCycleWidth?: () => void;
		queryOptions?: string[];
	}

	const { block, value, onChange, onRemove, onCycleWidth, queryOptions }: Props = $props();

	const effectiveOptions = $derived(queryOptions ?? block.options ?? []);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleInput(v: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => onChange(v), 300);
	}
</script>

<div class="group/block relative rounded-xl border border-border/55 bg-card surface-raised overflow-hidden flex flex-col gap-1 px-4 py-3 transition-[box-shadow,border-color] duration-(--motion-medium) hover:shadow-sm hover:border-border/70">
	<!-- Hover controls -->
	{#if onRemove || onCycleWidth}
		<div class="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
			{#if onCycleWidth}
				<button
					class="text-[10px] font-mono px-1 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background"
					onclick={onCycleWidth}
					title="Cycle width"
				>{block.width === 1 ? 'S' : block.width === 2 ? 'M' : 'L'}</button>
			{/if}
			{#if onRemove}
				<button
					class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors bg-background"
					onclick={onRemove}
					title="Remove filter"
				><X class="w-3 h-3" /></button>
			{/if}
		</div>

		<!-- Drag handle -->
		<button class="drag-handle absolute left-1.5 top-1.5 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
			<GripVertical class="w-3.5 h-3.5" />
		</button>
	{/if}

	<span class="text-2xs font-semibold text-muted-foreground/80">{block.label}</span>

	{#if block.filterKind === 'dropdown'}
		<select
			aria-label={block.label}
			class="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
			{value}
			onchange={(e) => onChange((e.target as HTMLSelectElement).value)}
		>
			{#if !block.defaultValue}
				<option value="">All</option>
			{/if}
			{#each effectiveOptions as opt (opt)}
				<option value={opt}>{opt}</option>
			{/each}
		</select>

	{:else if block.filterKind === 'text-input'}
		<input
			type="text"
			class="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
			value={value}
			oninput={(e) => handleInput((e.target as HTMLInputElement).value)}
			placeholder={block.defaultValue ?? `Filter ${block.label}…`}
		/>

	{:else if block.filterKind === 'date-range'}
		{@const [startVal, endVal] = value ? value.split(',') : ['', '']}
		<div class="flex items-center gap-1.5">
			<input
				type="date"
				class="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
				value={startVal ?? ''}
				onchange={(e) => onChange(`${(e.target as HTMLInputElement).value},${endVal ?? ''}`)}
			/>
			<span class="text-xs text-muted-foreground">–</span>
			<input
				type="date"
				class="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
				value={endVal ?? ''}
				onchange={(e) => onChange(`${startVal ?? ''},${(e.target as HTMLInputElement).value}`)}
			/>
		</div>

	{:else if block.filterKind === 'button-group'}
		<div class="flex flex-wrap gap-1">
			{#each effectiveOptions as opt (opt)}
				<button
					class="h-6 px-2.5 rounded text-xs border transition-colors
						{value === opt
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border bg-background text-foreground hover:bg-muted/50'}"
					onclick={() => onChange(opt)}
				>{opt}</button>
			{/each}
		</div>
	{/if}
</div>
