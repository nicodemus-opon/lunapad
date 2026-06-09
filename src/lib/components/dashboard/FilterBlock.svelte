<script lang="ts">
	import type { FilterBlock } from '$lib/types/gui-pipeline';

	interface Props {
		block: FilterBlock;
		value: string;
		onChange: (v: string) => void;
		// Options derived from a query result cell
		queryOptions?: string[];
	}

	const { block, value, onChange, queryOptions }: Props = $props();

	const effectiveOptions = $derived(queryOptions ?? block.options ?? []);

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleInput(v: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => onChange(v), 300);
	}
</script>

<div class="flex flex-col gap-1">
	<span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{block.label}</span>

	{#if block.filterKind === 'dropdown'}
		<select
			aria-label={block.label}
			class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
			class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
			value={value}
			oninput={(e) => handleInput((e.target as HTMLInputElement).value)}
			placeholder={block.defaultValue ?? `Filter ${block.label}…`}
		/>

	{:else if block.filterKind === 'date-range'}
		{@const [startVal, endVal] = value ? value.split(',') : ['', '']}
		<div class="flex items-center gap-1.5">
			<input
				type="date"
				class="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
				value={startVal ?? ''}
				onchange={(e) => onChange(`${(e.target as HTMLInputElement).value},${endVal ?? ''}`)}
			/>
			<span class="text-xs text-muted-foreground">–</span>
			<input
				type="date"
				class="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
				value={endVal ?? ''}
				onchange={(e) => onChange(`${startVal ?? ''},${(e.target as HTMLInputElement).value}`)}
			/>
		</div>

	{:else if block.filterKind === 'button-group'}
		<div class="flex flex-wrap gap-1">
			{#each effectiveOptions as opt (opt)}
				<button
					class="h-7 px-3 rounded text-xs border transition-colors
						{value === opt
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-border bg-background text-foreground hover:bg-muted/50'}"
					onclick={() => onChange(opt)}
				>{opt}</button>
			{/each}
		</div>
	{/if}
</div>
