<script lang="ts">
	import { Table2, TrendingUp, Sigma } from '@lucide/svelte';
	import type { ResultViewMode } from '$lib/types/gui-pipeline';

	interface Props {
		viewMode: ResultViewMode;
		onSwitch: (mode: ResultViewMode) => void;
		/** Tab result view uses slightly taller chrome than the inline cell view */
		size?: 'sm' | 'md';
	}

	let { viewMode, onSwitch, size = 'sm' }: Props = $props();

	const items: { mode: ResultViewMode; label: string; icon: typeof Table2 }[] = [
		{ mode: 'table', label: 'Table', icon: Table2 },
		{ mode: 'chart', label: 'Chart', icon: TrendingUp },
		{ mode: 'stats', label: 'Stats', icon: Sigma }
	];

	const btnClass = $derived(size === 'md' ? 'h-6 px-2' : 'h-5 px-1.5');
</script>

<div
	class="inline-flex items-center gap-px rounded-md border border-border/60 bg-muted/30 p-0.5"
	role="tablist"
	aria-label="Result view mode"
>
	{#each items as item (item.mode)}
		{@const Icon = item.icon}
		<button
			type="button"
			role="tab"
			aria-selected={viewMode === item.mode}
			class="inline-flex items-center gap-1 rounded-sm text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {btnClass} {viewMode ===
			item.mode
				? 'bg-secondary text-secondary-foreground'
				: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
			onclick={() => onSwitch(item.mode)}
		>
			<Icon class="h-3 w-3" />
			{item.label}
		</button>
	{/each}
</div>
