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
</script>

<div
	class="result-mode-tabs {size === 'md' ? 'is-md' : ''}"
	role="tablist"
	aria-label="Result view mode"
>
	{#each items as item (item.mode)}
		{@const Icon = item.icon}
		<button
			type="button"
			role="tab"
			aria-selected={viewMode === item.mode}
			class="result-mode-tab"
			class:is-active={viewMode === item.mode}
			onclick={() => onSwitch(item.mode)}
		>
			<Icon class="h-3 w-3" />
			{item.label}
		</button>
	{/each}
</div>

<style>
	.result-mode-tabs {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0 0.125rem;
	}
	.result-mode-tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: color 0.12s ease;
	}
	.result-mode-tabs.is-md .result-mode-tab {
		height: 1.5rem;
	}
	.result-mode-tab:hover {
		color: var(--foreground);
	}
	.result-mode-tab.is-active {
		color: var(--foreground);
	}
	.result-mode-tab.is-active::after {
		position: absolute;
		right: 0;
		bottom: -0.18rem;
		left: 0;
		height: 2px;
		border-radius: 999px;
		background: var(--secondary);
		content: '';
	}
	.result-mode-tab:focus-visible {
		outline: none;
		border-radius: var(--radius-sm);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 35%, transparent);
	}
</style>
